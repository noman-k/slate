import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // AI agents call the MCP endpoint with an agent key, not a session cookie; the route
  // checks the key itself (and answers 503 when Supabase isn't connected).
  if (request.nextUrl.pathname === '/api/mcp') return NextResponse.next();
  // Apps connecting with OAuth: discovery, registration and tokens are for apps, not
  // people, and check what they're sent themselves. (/oauth/authorize is a page people sign in to.)
  if (request.nextUrl.pathname.startsWith('/api/oauth/') || request.nextUrl.pathname.startsWith('/.well-known/')) return NextResponse.next();
  // The contact form is for everyone, signed in or not; the route reads the session itself.
  if (request.nextUrl.pathname === '/api/contact') return NextResponse.next();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // The front page, docs and privacy page are public; the front page adapts to signed-in visitors itself.
  const isPublic = request.nextUrl.pathname === '/' || request.nextUrl.pathname.startsWith('/auth') || request.nextUrl.pathname.startsWith('/docs') || request.nextUrl.pathname === '/privacy' || request.nextUrl.pathname === '/contact';
  // Without Supabase there are no accounts, so there's no workspace to show: the auth
  // pages explain what's missing.
  if (!url || !key) {
    if (isPublic) return NextResponse.next();
    if (request.nextUrl.pathname.startsWith('/api/'))
      return NextResponse.json({error: 'Slate is not connected to Supabase'}, {status: 503, headers: {'Cache-Control': 'private, no-store'}});
    const setup = request.nextUrl.clone();
    setup.pathname = '/auth/login';
    setup.search = '';
    return NextResponse.redirect(setup);
  }
  let response = NextResponse.next({request});
  const supabase = createServerClient(url, key, {cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: (items) => {
      items.forEach(({name, value}) => request.cookies.set(name, value));
      response = NextResponse.next({request});
      items.forEach(({name, value, options}) => response.cookies.set(name, value, options));
    },
  }});
  const {data: {user}} = await supabase.auth.getUser();
  if (!user && !isPublic) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      const unauthorized = NextResponse.json({error: 'Authentication required'}, {status: 401, headers: {'Cache-Control': 'private, no-store'}});
      response.cookies.getAll().forEach(cookie => unauthorized.cookies.set(cookie));
      return unauthorized;
    }
    const destination = request.nextUrl.clone();
    destination.pathname = '/auth/login';
    // Only "next": the page's own query (an app's sign-in request, say) rides inside it.
    destination.search = '';
    destination.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(destination);
  }
  // Keep refreshed cookies on the exact returned response.
  return response;
}
export const config = {matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']};
