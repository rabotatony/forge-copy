import * as fs from 'node:fs';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';

// --- CRC32 --------------------------------------------------
function makeCRC32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}
const CRC32_TABLE = makeCRC32Table();

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]!) & 0xFF]! ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// --- Binary Protocol: Delta Record --------------------------
// Layout: [seq: u64][op: u8][keyLen: u32][valLen: u32][key][value?][crc: u32]
const DELTA_MIN_SIZE = 8 + 1 + 4 + 4 + 4; // header + crc
const U32_MAX = 0xFFFFFFFF;

const OP_PUT = 0x01;
const OP_DELETE = 0x02;

interface Delta {
  seq: bigint;
  op: number;
  key: string;
  value: Uint8Array | null;
}

function encodeDelta(d: Delta): Buffer {
  const keyBuf = Buffer.from(d.key, 'utf-8');
  const valBuf = d.value
    ? Buffer.from(d.value.buffer, d.value.byteOffset, d.value.byteLength)
    : Buffer.alloc(0);
  if (keyBuf.length > U32_MAX) throw new Error(`Key length exceeds u32 limit: ${keyBuf.length}`);
  if (valBuf.length > U32_MAX) throw new Error(`Value length exceeds u32 limit: ${valBuf.length}`);
  const bodyLen = 8 + 1 + 4 + 4 + keyBuf.length + valBuf.length;
  const buf = Buffer.allocUnsafe(bodyLen + 4);
  let p = 0;
  buf.writeBigUInt64BE(d.seq, p); p += 8;
  buf.writeUInt8(d.op, p); p += 1;
  buf.writeUInt32BE(keyBuf.length, p); p += 4;
  buf.writeUInt32BE(valBuf.length, p); p += 4;
  keyBuf.copy(buf, p); p += keyBuf.length;
  if (valBuf.length) { valBuf.copy(buf, p); p += valBuf.length; }
  buf.writeUInt32BE(crc32(buf.subarray(0, p) as Buffer), p);
  return buf;
}

export function decodeDelta(
  buf: Buffer,
  off: number,
): { delta: Delta; nextOffset: number } | null {
  if (off + DELTA_MIN_SIZE > buf.length) return null;
  const start = off;
  const seq = buf.readBigUInt64BE(off); off += 8;
  const op = buf.readUInt8(off); off += 1;
  const keyLen = buf.readUInt32BE(off); off += 4;
  const valLen = buf.readUInt32BE(off); off += 4;
  if (off + keyLen + valLen + 4 > buf.length) return null;
  const key = buf.toString('utf-8', off, off + keyLen); off += keyLen;
  const value = valLen > 0 ? new Uint8Array(buf.slice(off, off + valLen)) : null;
  off += valLen;
  const storedCrc = buf.readUInt32BE(off); off += 4;
  const bodyLen = off - start - 4;
  const computed = crc32(buf.subarray(start, start + bodyLen) as Buffer);
  if (computed !== storedCrc)
    throw new Error(`CRC mismatch at offset ${start}: stored=${storedCrc}, computed=${computed}`);
  return { delta: { seq, op, key, value }, nextOffset: off };
}

// --- Binary Protocol: Checkpoint ----------------------------
const CHECKPOINT_MAGIC = 'AXCP';
const CHECKPOINT_VERSION = 1;

export function serializeCheckpoint(seq: bigint, state: Map<string, Uint8Array | null>): Buffer {
  const entries = Array.from(state.entries());
  let size = 4 + 1 + 8 + 4;
  for (const [k, v] of entries) {
    size += 4 + Buffer.byteLength(k, 'utf-8') + 1 + 4 + (v ? v.byteLength : 0);
  }
  const buf = Buffer.allocUnsafe(size);
  let p = 0;
  buf.write(CHECKPOINT_MAGIC, p); p += 4;
  buf.writeUInt8(CHECKPOINT_VERSION, p); p += 1;
  buf.writeBigUInt64BE(seq, p); p += 8;
  buf.writeUInt32BE(entries.length, p); p += 4;
  for (const [k, v] of entries) {
    const kbuf = Buffer.from(k, 'utf-8');
    buf.writeUInt32BE(kbuf.length, p); p += 4;
    kbuf.copy(buf, p); p += kbuf.length;
    const tomb = v === null ? 1 : 0;
    buf.writeUInt8(tomb, p); p += 1;
    const vlen = v ? v.byteLength : 0;
    buf.writeUInt32BE(vlen, p); p += 4;
    if (v && vlen > 0) {
      Buffer.from(v.buffer, v.byteOffset, v.byteLength).copy(buf, p);
      p += vlen;
    }
  }
  return buf;
}

function loadCheckpoint(buf: Buffer): { seq: bigint; state: Map<string, Uint8Array | null> } {
  let p = 0;
  const magic = buf.toString('utf-8', 0, 4); p += 4;
  if (magic !== CHECKPOINT_MAGIC) throw new Error(`Bad checkpoint magic: ${magic}`);
  const version = buf.readUInt8(p); p += 1;
  if (version !== CHECKPOINT_VERSION) throw new Error(`Unknown checkpoint version: ${version}`);
  const seq = buf.readBigUInt64BE(p); p += 8;
  const count = buf.readUInt32BE(p); p += 4;
  const state = new Map<string, Uint8Array | null>();
  for (let i = 0; i < count; i++) {
    const klen = buf.readUInt32BE(p); p += 4;
    const k = buf.toString('utf-8', p, p + klen); p += klen;
    const tomb = buf.readUInt8(p); p += 1;
    const vlen = buf.readUInt32BE(p); p += 4;
    const v = tomb === 1 ? null : (vlen > 0 ? new Uint8Array(buf.slice(p, p + vlen)) : new Uint8Array(0));
    p += vlen;
    state.set(k, v);
  }
  return { seq, state };
}

// --- Checkpoint file management -----------------------------
interface CheckpointInfo { seq: bigint; path: string }

export interface KernelStats {
  seq: bigint;
  keyCount: number;
  checkpointSeq: bigint;
  walBytes: number;
}

// --- LSSKernel ----------------------------------------------
export class LSSKernel {
  private cpDir: string;
  private logPath: string;
  private logFd: number;
  private seq: bigint = 0n;
  private state: Map<string, Uint8Array | null> = new Map();
  private seqIndex: Map<bigint, number> = new Map(); // seq -> byte offset of that record
  private writeOffset: number = 0;
  private baseCheckpoint: CheckpointInfo | null = null;

  constructor(rootDir: string) {
    this.cpDir = path.join(rootDir, 'checkpoints');
    this.logPath = path.join(rootDir, 'active.lss');
    fs.mkdirSync(this.cpDir, { recursive: true });
    // Ensure genesis checkpoint.
    const genesisPath = path.join(this.cpDir, 'cp-0.lssc');
    if (!fs.existsSync(genesisPath)) {
      const empty = serializeCheckpoint(0n, new Map());
      const tmp = genesisPath + '.tmp';
      fs.writeFileSync(tmp, empty);
      fs.renameSync(tmp, genesisPath);
    }
    this.logFd = fs.openSync(this.logPath, fs.existsSync(this.logPath) ? 'r+' : 'w+');
    this.recover();
  }

  private recover(): void {
    const stat = fs.fstatSync(this.logFd);
    const buf = Buffer.allocUnsafe(stat.size);
    if (stat.size > 0) fs.readSync(this.logFd, buf, 0, stat.size, 0);

    // Pass 1: scan WAL to build seqIndex.
    let pos = 0;
    while (pos < stat.size) {
      const res = decodeDelta(buf, pos);
      if (!res) {
        fs.ftruncateSync(this.logFd, pos);
        this.writeOffset = pos;
        break;
      }
      this.seqIndex.set(res.delta.seq, pos);
      this.seq = res.delta.seq;
      pos = res.nextOffset;
    }
    this.writeOffset = pos;

    // Pass 2: load checkpoint and replay deltas.
    const cps = this.listCheckpoints();
    let cpLoaded: { seq: bigint; state: Map<string, Uint8Array | null> } | null = null;
    if (cps.length > 0) {
      const latest = cps[cps.length - 1]!;
      this.baseCheckpoint = latest;
      cpLoaded = loadCheckpoint(fs.readFileSync(latest.path));
      if (cpLoaded.seq > this.seq)
        throw new Error(`Checkpoint ${cpLoaded.seq} is ahead of log tail ${this.seq}`);
    }
    this.state = new Map();
    if (cpLoaded) {
      for (const [k, v] of cpLoaded.state) this.state.set(k, v);
    }
    const scanStart = cpLoaded
      ? (this.seqIndex.get(cpLoaded.seq + 1n) ?? this.writeOffset)
      : 0;
    let p = scanStart;
    while (p < this.writeOffset) {
      const res = decodeDelta(buf, p);
      if (!res) throw new Error('Corruption during recovery replay');
      this.applyToState(res.delta);
      p = res.nextOffset;
    }
  }

  private applyToState(delta: Delta): void {
    if (delta.op === OP_DELETE || delta.value === null) {
      this.state.set(delta.key, null);
    } else {
      this.state.set(delta.key, delta.value);
    }
  }

  private listCheckpoints(): CheckpointInfo[] {
    const files = fs.readdirSync(this.cpDir)
      .filter(f => f.endsWith('.lssc'))
      .map(f => {
        const seq = BigInt(f.replace(/^cp-/, '').replace(/\.lssc$/, ''));
        return { seq, path: path.join(this.cpDir, f) };
      });
    files.sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
    return files;
  }

  apply(key: string, value: Uint8Array | null): bigint {
    this.seq += 1n;
    const op = value === null ? OP_DELETE : OP_PUT;
    const delta: Delta = { seq: this.seq, op, key, value };
    const encoded = encodeDelta(delta);
    this.seqIndex.set(this.seq, this.writeOffset);
    fs.writeSync(this.logFd, encoded, 0, encoded.length, this.writeOffset);
    this.writeOffset += encoded.length;
    this.applyToState(delta);
    return this.seq;
  }

  get(key: string): Uint8Array | undefined {
    const val = this.state.get(key);
    if (val === undefined) return undefined;
    if (val === null) return undefined; // tombstoned
    return val;
  }

  /** Iterate all live (non-tombstoned) keys. */
  keys(): IterableIterator<string> {
    const live: string[] = [];
    for (const [k, v] of this.state) {
      if (v !== null) live.push(k);
    }
    return live[Symbol.iterator]();
  }

  /** Returns all live key-value pairs. */
  current(): Map<string, Uint8Array | null> {
    return new Map(this.state);
  }

  checkpoint(): bigint {
    const cpPath = path.join(this.cpDir, `cp-${this.seq}.lssc`);
    const tmp = cpPath + '.tmp';
    const buf = serializeCheckpoint(this.seq, this.state);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, cpPath);
    this.baseCheckpoint = { seq: this.seq, path: cpPath };
    return this.seq;
  }

  rollback(targetSeq: bigint): void {
    if (targetSeq > this.seq)
      throw new Error(`Target seq ${targetSeq} is ahead of current seq ${this.seq}`);
    // Find the byte offset to truncate to.
    const truncateAt = targetSeq === 0n
      ? 0
      : (() => {
        const off = this.seqIndex.get(targetSeq);
        if (off === undefined) throw new Error(`Seq ${targetSeq} not found in seqIndex`);
        // We need the END of this record — scan forward from off.
        const stat = fs.fstatSync(this.logFd);
        const buf = Buffer.allocUnsafe(stat.size);
        fs.readSync(this.logFd, buf, 0, stat.size, 0);
        const res = decodeDelta(buf, off);
        if (!res) throw new Error(`Could not decode record at offset ${off}`);
        return res.nextOffset;
      })();
    fs.ftruncateSync(this.logFd, truncateAt);
    this.writeOffset = truncateAt;
    // Remove future checkpoints.
    const cps = this.listCheckpoints();
    for (const cp of cps) {
      if (cp.seq > targetSeq) fs.rmSync(cp.path, { force: true });
    }
    // Rebuild state.
    this.seqIndex = new Map();
    this.seq = 0n;
    this.state = new Map();
    this.recover();
  }

  stats(): KernelStats {
    let keyCount = 0;
    for (const v of this.state.values()) { if (v !== null) keyCount++; }
    return {
      seq: this.seq,
      keyCount,
      checkpointSeq: this.baseCheckpoint?.seq ?? 0n,
      walBytes: this.writeOffset,
    };
  }

  sync(): void { fs.fsyncSync(this.logFd); }
  close(): void { fs.closeSync(this.logFd); }
}
