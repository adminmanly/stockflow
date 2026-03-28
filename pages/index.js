import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    window.location.href = '/dashboard'
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f7f4', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380, padding: '0 16px' }}>
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', color: '#111' }}>STOCKFLOW</div>
          <div style={{ fontSize: 13, color: '#777', marginTop: 4 }}>Inventory intelligence</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e0e0e0', padding: '28px' }}>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 20 }}>Sign in</div>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#666', display: 'block', marginBottom: 4 }}>Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', fontSize: 14, padding: '9px 12px', border: '0.5px solid #d0d0d0', borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#666', display: 'block', marginBottom: 4 }}>Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', fontSize: 14, padding: '9px 12px', border: '0.5px solid #d0d0d0', borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
            <button type="submit" style={{ width: '100%', padding: '10px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
