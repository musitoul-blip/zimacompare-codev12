import { useEffect, useRef, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const TOOLTIP_CONTENT_STYLE = {
  background: '#1e293b', border: '1px solid #475569', borderRadius: 6,
  fontSize: 12, color: '#f1f5f9', padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
}
const TOOLTIP_LABEL_STYLE = { color: '#cbd5e1', fontWeight: 600, marginBottom: 4 }
const TOOLTIP_ITEM_STYLE  = { color: '#f1f5f9' }


export default function ProgressChart({ status }) {
  const [history, setHistory] = useState([])
  const lastTs = useRef(0)

  useEffect(() => {
    if (!status) return
    const isActive = !['IDLE', 'ERROR'].includes(status.app_state)
    if (!isActive) return

    const now = Date.now()
    if (now - lastTs.current < 800) return
    lastTs.current = now

    setHistory(prev => {
      const point = {
        t: new Date(now).toLocaleTimeString('fr-FR', { hour12: false }),
        Nouveaux:   status.new_count || 0,
        Modifiés:   status.different_count || 0,
        Supprimés:  status.deleted_count || 0,
        Identiques: status.identical_count || 0,
      }
      if (prev.length > 0 && status.processed < 100 && prev[prev.length - 1].Identiques > 100) {
        return [point]
      }
      const next = [...prev, point]
      return next.length > 120 ? next.slice(-120) : next
    })
  }, [status?.processed, status?.app_state])

  useEffect(() => {
    if (status?.app_state === 'IDLE' && !status?.scan_done && status?.processed === 0) {
      setHistory([])
    }
  }, [status?.app_state, status?.scan_done, status?.processed])

  if (history.length < 2) return null

  return (
    <div style={{ marginTop: 12, padding: 8, background: 'var(--bg)', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4,
                    textTransform:'uppercase', letterSpacing:'.05em' }}>
        Évolution des compteurs en temps réel
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gIdent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#9ca3af" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#9ca3af" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#22c55e" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gDiff" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#f59e0b" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gDel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#ef4444" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#94a3b8' }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} width={45} />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          <Area type="monotone" dataKey="Identiques" stackId="1" stroke="#9ca3af" fill="url(#gIdent)" />
          <Area type="monotone" dataKey="Nouveaux"   stackId="1" stroke="#22c55e" fill="url(#gNew)" />
          <Area type="monotone" dataKey="Modifiés"   stackId="1" stroke="#f59e0b" fill="url(#gDiff)" />
          <Area type="monotone" dataKey="Supprimés"  stackId="1" stroke="#ef4444" fill="url(#gDel)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
