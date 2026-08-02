"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Bell, Webhook } from "lucide-react";
import { toast } from "sonner";
import { useNotifications, useCreateNotification, useDeleteNotification, useToggleNotification } from "@/components/forge/use-forge-api-v2";
import { formatRelativeTime } from "@/components/forge/format";

export function NotificationsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useNotifications(projectId);
  const createNotif = useCreateNotification(projectId);
  const deleteNotif = useDeleteNotification(projectId);
  const toggleNotif = useToggleNotification(projectId);
  const [event, setEvent] = useState("success");
  const [url, setUrl] = useState("");

  const handleAdd = async () => {
    if (!url) { toast.error("URL is required"); return; }
    try {
      await createNotif.mutateAsync({ event, url });
      toast.success("Notification created");
      setUrl("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNotif.mutateAsync(id);
      toast.success("Notification deleted");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleNotif.mutateAsync({ notificationId: id, enabled: !enabled });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-5" />Add Notification</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr_auto] items-end">
            <div className="space-y-1">
              <Label>Event</Label>
              <Select value={event} onValueChange={setEvent}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="started">started</SelectItem>
                  <SelectItem value="success">success</SelectItem>
                  <SelectItem value="failure">failure</SelectItem>
                  <SelectItem value="always">always</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Webhook URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.example.com/..." className="font-mono text-sm" />
            </div>
            <Button onClick={handleAdd} disabled={createNotif.isPending}><Plus className="mr-2 size-4" />Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-5" />
            Notifications
            <span className="text-sm font-normal text-muted-foreground">({data?.notifications.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> :
             data?.notifications.length === 0 ? <p className="text-sm text-muted-foreground">No notifications yet.</p> :
             data?.notifications.map((n) => (
              <div key={n.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={n.event === "failure" ? "destructive" : n.event === "success" ? "secondary" : "outline"}>{n.event}</Badge>
                    <code className="text-xs truncate font-mono">{n.url}</code>
                  </div>
                  <p className="text-xs text-muted-foreground">created {formatRelativeTime(n.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={n.enabled} onCheckedChange={() => handleToggle(n.id, n.enabled)} aria-label="Toggle" />
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(n.id)} aria-label="Delete">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
