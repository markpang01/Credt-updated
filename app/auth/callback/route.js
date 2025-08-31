import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = createServerClient()
    
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      
      if (error) {
        console.error('Auth callback error:', error)
        return NextResponse.redirect(`${requestUrl.origin}?error=auth_error`)
      }
    } catch (error) {
      console.error('Auth exchange error:', error)
      return NextResponse.redirect(`${requestUrl.origin}?error=auth_error`)
    }
  }

  // Redirect to home page after successful authentication
  return NextResponse.redirect(requestUrl.origin)
}