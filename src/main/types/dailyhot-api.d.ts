declare module 'dailyhot-api/dist/app.js' {
  const app: {
    fetch(request: Request): Response | Promise<Response>
  }
  export default app
}
