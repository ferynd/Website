// Synthetic route for the API contract registry test: handlers are declared
// locally and exported only through an export list (one aliased).
async function handler() {
  return new Response(null, { status: 401 });
}
function GET() {
  return new Response(null, { status: 401 });
}
export { GET, handler as POST };
export const dynamic = 'force-dynamic';
