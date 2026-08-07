# AI-Audit Workflow Template for Forge

This workflow runs the AI-detection suite on an uploaded project.
It produces an authenticity report as part of the CI/CD pipeline.

## Workflow Definition (YAML)

    name: ai-content-audit
    description: Detect AI-generated content in the project

    triggers:
      - type: on-upload
      - type: manual

    steps:
      - id: collect-files
        name: Collect project files
        action: forge.collect-files
        with:
          extensions: [.ts, .tsx, .js, .jsx, .css, .md, .txt]

      - id: run-audit
        name: Run AI audit
        action: forge.ai-audit
        with:
          files: ${{ steps.collect-files.outputs.files }}
          threshold: 0.5

      - id: report
        name: Generate report
        action: forge.report
        with:
          result: ${{ steps.run-audit.outputs.result }}
          fail-if: exceeds-threshold

## What It Does

1. Collect files - gathers all relevant files from the uploaded project
2. Run audit - analyzes each file with the appropriate detector (text/code/CSS)
3. Report - produces an authenticity report, optionally failing the build

## Use Cases

- Content authenticity gate - fail deployment if too much AI content
- Documentation review - flag AI-generated docs for human review
- Code quality check - detect AI-generated code patterns
- Design audit - detect AI-generated design patterns

## Integration with Forge

This template can be added to Forge workflow template library.
Users can apply it to any project they upload.

The audit results feed into Forge existing reporting and
GitHub check-run system, so AI-detection appears alongside
other build results.