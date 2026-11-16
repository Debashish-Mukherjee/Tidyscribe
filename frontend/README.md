# Tidyscribe frontend

Next.js and TypeScript frontend for Tidyscribe, a self-hosted workbench for turning AI-generated content into polished technical documents.

See the [project README](../README.md) for the full stack and [development guide](../docs/development.md) for setup and validation.

## Local development

Use Node.js 24, then run:

```bash
npm ci
npm run dev
```

Open http://localhost:3000. The backend must be available at the configured API URL.

## Validation

```bash
npm run lint
npm test
npm run build
```

Browser tests require the running application stack; see the development guide.
