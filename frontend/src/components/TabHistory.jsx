import { useState, useEffect } from 'react'
import { api, fmtSize } from '../api.js'

export default function TabHistory() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('')

  const load = async () => {
    try { setReports(await api.reports()) }
    catch { setReports([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = reports.filter(r => r.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <input type="text" placeholder="Filtrer…" value={filter}
          onChange={e => setFilter(e.target.value)} style={{ maxWidth:280 }} />
        <button className="btn-ghost" onClick={load}>↻</button>
        <span style={{ color:'var(--muted)', fontSize:12, marginLeft:'auto' }}>
          {filtered.length} rapport(s)
        </span>
      </div>

      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>
            Aucun rapport. Lancez un scan puis une synchronisation.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Date</th>
                <th>Taille</th>
                <th style={{ width:80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.name}>
                  <td>
                    <span className="mono">{r.name}</span>
                    {r.name.includes('simulation') && (
                      <span className="badge badge-yellow" style={{ marginLeft:8 }}>dry-run</span>
                    )}
                    {r.name.includes('execution') && (
                      <span className="badge badge-green" style={{ marginLeft:8 }}>réel</span>
                    )}
                  </td>
                  <td style={{ color:'var(--muted)', fontSize:12 }}>
                    {new Date(r.date).toLocaleString('fr-FR')}
                  </td>
                  <td style={{ color:'var(--muted)' }}>{fmtSize(r.size)}</td>
                  <td>
                    <a href={`/api/reports/${r.name}`} download>
                      <button className="btn-ghost" style={{ padding:'4px 10px', fontSize:12 }}>⬇</button>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
