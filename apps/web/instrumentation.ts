export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeTracing } = await import('./instrumentation-node');
    await registerNodeTracing();
  }
}
