// A developer's .env may contain NODE_ENV=development. Never bundle development React for production.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
