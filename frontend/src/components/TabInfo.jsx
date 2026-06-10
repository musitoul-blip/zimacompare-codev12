import { useState, useEffect } from 'react'
import { api, fmtSize, fmtNum } from '../api.js'

const CAT_COLOR = {
  audio: '#22c55e', image: '#4f8ef7', video: '#a855f7',
  doc: '#f59e0b', archive: '#ef4444', autre: '#64748b',
}

function Bar({ frac, color }) {
  return (
    <div style={{ height:8, background:'var(--bg)', borderRadius:4, overflow:'hidden', minWidth:80 }}>
      <div style={{ width:`${Math.max(2, Math.round(frac*100))}%`, height:'100%', background:color }} />
    </div>
  )
}

function PathResult({ path, data }) {
  if (data === 'loading')
    return <div className="card"><strong className="mono" style={{ fontSize:13, wordBreak:'break-all' }}>{path}</strong><div style={{ color:'var(--muted)', fontSize:12, marginTop:8 }}>⟳ Analyse…</div></div>
  if (data && data.error)
    return <div className="card"><strong className="mono" style={{ fontSize:13, wordBreak:'break-all' }}>{path}</strong><div style={{ color:'var(--danger)', fontSize:12, marginTop:8 }}>✗ {data.error}</div></div>
  if (!data) return null
  const maxBytes = (data.extensions[0] && data.extensions[0].bytes) || 1
  return (
    <div className="card" style={{ padding:0, overflow:'hidden' }}>
      <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <strong className="mono" style={{ fontSize:13, wordBreak:'break-all' }}>{path}</strong>
        <span style={{ color:'var(--muted)', fontSize:12 }}>
          {fmtNum(data.total_files)} fichiers · {fmtSize(data.total_bytes)} · {data.ext_count} types{data.truncated ? ' · (tronque)' : ''}
        </span>
      </div>
      <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', gap:8, flexWrap:'wrap' }}>
        {data.categories.map(c => (
          <span key={c.category} style={{ fontSize:11, padding:'3px 8px', borderRadius:4, background:'var(--bg)', color: CAT_COLOR[c.category] || 'var(--muted)' }}>
            {c.category} : {fmtNum(c.count)} · {fmtSize(c.bytes)}
          </span>
        ))}
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ minWidth:520 }}>
          <thead><tr>
            <th>Extension</th><th>Categorie</th>
            <th style={{ textAlign:'right' }}>Nombre</th>
            <th style={{ textAlign:'right' }}>Taille</th><th>Part (taille)</th>
          </tr></thead>
          <tbody>
            {data.extensions.map(e => (
              <tr key={e.ext}>
                <td className="mono">{e.ext}</td>
                <td style={{ color: CAT_COLOR[e.category] || 'var(--muted)', fontSize:12 }}>{e.category}</td>
                <td className="mono" style={{ textAlign:'right', color:'var(--muted)' }}>{fmtNum(e.count)}</td>
                <td className="mono" style={{ textAlign:'right' }}>{fmtSize(e.bytes)}</td>
                <td><Bar frac={e.bytes / maxBytes} color={CAT_COLOR[e.category] || 'var(--muted)'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function TabInfo() {
  const [paths,   setPaths]   = useState([])
  const [results, setResults] = useState({})
  const [busy,    setBusy]    = useState(false)
  const [newPath, setNewPath] = useState('')

  useEffect(() => {
    api.pathsHistory().then(h => {
      const uniq = [...new Set(h.flatMap(e => [e.source, e.target]).filter(Boolean))]
      const roots = uniq.filter(p => !uniq.some(q => q !== p && p.startsWith(q + '/')))
      setPaths(roots.map(p => ({ path: p, checked: false })))
    }).catch(() => {})
  }, [])

  function toggle(p) {
    setPaths(prev => prev.map(x => x.path === p ? { ...x, checked: !x.checked } : x))
  }

  function addPath() {
    const p = newPath.trim()
    if (!p) return
    setPaths(prev => prev.some(x => x.path === p)
      ? prev.map(x => x.path === p ? { ...x, checked: true } : x)
      : [...prev, { path: p, checked: true }])
    setNewPath('')
  }

  async function analyze() {
    setBusy(true); setResults({})
    const selected = paths.filter(x => x.checked).map(x => x.path)
    for (const p of selected) {
      setResults(prev => ({ ...prev, [p]: 'loading' }))
      try {
        const d = await api.fileTypes(p)
        setResults(prev => ({ ...prev, [p]: d }))
      } catch (e) {
        setResults(prev => ({ ...prev, [p]: { error: e.message } }))
      }
    }
    setBusy(false)
  }

  const anyChecked = paths.some(x => x.checked)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div className="card">
        <h3 style={{ marginBottom:12, fontSize:14 }}>Chemins a analyser</h3>
        {paths.length === 0 ? (
          <div style={{ color:'var(--muted)', fontSize:12 }}>Aucun chemin dans l'historique.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {paths.map(x => (
              <label key={x.path} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', textTransform:'none', letterSpacing:0, fontSize:12, color:'var(--text)' }}>
                <input type="checkbox" checked={x.checked} onChange={() => toggle(x.path)} style={{ accentColor:'var(--accent)' }} />
                <span className="mono">{x.path}</span>
              </label>
            ))}
          </div>
        )}
        <div style={{ marginTop:10, display:'flex', gap:8, flexWrap:'wrap' }}>
          <input type="text" value={newPath} onChange={e => setNewPath(e.target.value)}
            placeholder="/disks/... ou /network/..." onKeyDown={e => { if (e.key === 'Enter') addPath() }}
            style={{ flex:'1 1 260px', minWidth:0 }} />
          <button className="btn-ghost" onClick={addPath} disabled={!newPath.trim()} style={{ fontSize:12, padding:'6px 10px' }}>+ Ajouter</button>
        </div>
        <div style={{ marginTop:12, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <button className="btn-primary" onClick={analyze} disabled={busy || !anyChecked}>
            {busy ? '⟳ Analyse…' : '📊 Analyser'}
          </button>
          <span style={{ fontSize:11, color:'var(--muted)' }}>
            Lecture seule · les chemins reseau/pCloud sont plus lents.
          </span>
        </div>
      </div>
      {paths.filter(x => x.checked).map(x => (
        results[x.path] != null ? <PathResult key={x.path} path={x.path} data={results[x.path]} /> : null
      ))}
    </div>
  )
}
