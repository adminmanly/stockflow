import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode]         = useState('login') // 'login' | 'signup'
  const [loading, setLoading]   = useState(false)
  const [message, setMessage]   = useState('')
  const [error, setError]       = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        window.location.href = '/dashboard'
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        })
        if (error) throw error
        setMessage('Check your email for a confirmation link.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f7f4', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380, padding: '0 16px' }}>
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', color: '#111' }}>STOCKFLOW</div>
          <div style={{ fontSize: 13, color: '#777', marginTop: 4 }}>Inventory intelligence</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e0e0e0', padding: '28px 28px' }}>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 20 }}>
            {mode === 'login' ? 'Sign in to your account' : 'Create an account'}
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Email</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', fontSize: 14, padding: '9px 12px', border: '0.5px solid #d0d0d0', borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Password</label>
              <input
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', fontSize: 14, padding: '9px 12px', border: '0.5px solid #d0d0d0', borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            {error   && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6 }}>{error}</div>}
            {message && <div style={{ fontSize: 13, color: '#166534', marginBottom: 12, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6 }}>{message}</div>}
            <button
              type="submit" disabled={loading}
              style={{ width: '100%', padding: '10px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1, fontFamily: 'inherit' }}
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: '#777' }}>
            {mode === 'login' ? (
              <>Don&apos;t have an account? <span style={{ color: '#185fa5', cursor: 'pointer' }} onClick={() => setMode('signup')}>Sign up</span></>
            ) : (
              <>Already have an account? <span style={{ color: '#185fa5', cursor: 'pointer' }} onClick={() => setMode('login')}>Sign in</span></>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#aaa', textAlign: 'center', marginTop: 16 }}>
          Protected by Supabase Auth · All data encrypted at rest
        </div>
      </div>
    </div>
  )
}
