import { useEffect } from 'react'

export default function Dashboard() {
  useEffect(() => {
    window.location.href = '/stockflow.html'
  }, [])
  return null
}
