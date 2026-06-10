import { useState, useEffect } from 'react'
import { api, fmtSize, fmtPowerOnHours, copyToClipboard, downloadJson } from '../api.js'


function StatusPill({ passed, health }) {
  // health.level prend le pas si présent
  const level = health?.level
  if (level === 'danger') return <span className="badge" style={{ background:'#450a0a', color:'#fca5a5' }}>⚠ DANGER</span>
  if (level === 'warning') return <span className="badge" style={{ background:'#422006', color:'#fcd34d' }}>⚠ ATTENTION</span>
  if (level === 'ok' || passed === true) return <span className="badge badge-green">✓ OK</span>
  if (passed === false) return <span className="badge" style={{ background:'#450a0a', color:'#fca5a5' }}>✗ FAILED</span>
  return <span className="badge badge-gray">?</span>
}


function TempPill({ celsius }) {
  if (celsius == null) return <span style={{ color:'var(--muted)' }}>—</span>
  let color = 'var(--success)'
  if (celsius >= 60) color = 'var(--danger)'
  else if (celsius >= 50) color = 'var(--warning)'
  return <span style={{ color, fontWeight:600 }}>{celsius}°C</span>
}


function HealthBlock({ health }) {
  if (!health) return null
  if (health.level === 'ok' && (!health.warnings || !health.warnings.length)) return null
  const isWarn = health.level === 'warning'
  const isDanger = health.level === 'danger'
  const bg = isDanger ? '#450a0a' : (isWarn ? '#422006' : '#14532d')
  const color = isDanger ? '#fca5a5' : (isWarn ? '#fcd34d' : '#86efac')

  return (
    <div style={{
      padding:'8px 10px', borderRadius:6, background:bg, color, fontSize:11,
      borderLeft:`3px solid ${color}`,
    }}>
      {health.issues?.length > 0 && (
        <div style={{ marginBottom: health.warnings?.length ? 6 : 0 }}>
          <strong>Problèmes critiques :</strong>
          <ul style={{ margin:'2px 0 0 18px', padding:0 }}>
            {health.issues.map((i, k) => <li key={k}>{i}</li>)}
          </ul>
        </div>
      )}
      {health.warnings?.length > 0 && (
        <div>
          <strong>Avertissements :</strong>
          <ul style={{ margin:'2px 0 0 18px', padding:0 }}>
            {health.warnings.map((w, k) => <li key={k}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}


function AgePill({ age }) {
  if (!age || age.level === 'ok' || age.level === 'unknown') return null
  const isOld = age.level === 'old'
  const bg = isOld ? '#450a0a' : '#422006'
  const color = isOld ? '#fca5a5' : '#fcd34d'
  const label = isOld ? '\u23f3 \u00c2g\u00e9 \u2014 \u00e0 remplacer' : '\u23f3 \u00c0 surveiller'
  const yrs = age.years != null ? ` (${age.years} ans)` : ''
  return <span className="badge" style={{ background:bg, color }}>{label}{yrs}</span>
}


function DeviceCard({ device }) {
  if (!device.ok) {
    return (
      <div className="card" style={{ padding:14, opacity:.6 }}>
        <strong style={{ fontFamily:'var(--mono)' }}>{device.device}</strong>
        <div style={{ color:'var(--muted)', fontSize:12, marginTop:4 }}>
          {device.error || 'Pas de données SMART'}
        </div>
      </div>
    )
  }

  const criticalAttrs = (device.attributes || []).filter(a => a.is_critical)
  const otherAttrs    = (device.attributes || []).filter(a => !a.is_critical)

  return (
    <div className="card" style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between',
                     gap:10, flexWrap:'wrap' }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600, fontFamily:'var(--mono)' }}>
            {device.device}
          </div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
            {device.model} · {device.disk_type}
            {device.capacity_bytes && ` · ${fmtSize(device.capacity_bytes)}`}
            {device.interface && ` · ${device.interface}`}
          </div>
          {device.serial && device.serial !== '?' && (
            <div style={{ fontSize:10, color:'var(--muted)', marginTop:2, fontFamily:'var(--mono)' }}>
              S/N : {device.serial} · FW : {device.firmware}
            </div>
          )}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
          <StatusPill passed={device.smart_status} health={device.health} />
          <AgePill age={device.health?.age} />
        </div>
      </div>

      <HealthBlock health={device.health} />

      <div style={{ display:'grid',
                     gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:8 }}>
        <Metric label="Température" value={<TempPill celsius={device.temperature} />} />
        <Metric label="Heures d'usage"
                value={device.power_on_hours != null
                  ? <><strong>{device.power_on_hours.toLocaleString('fr-FR')}h</strong>
                      <div style={{ fontSize:10, color:'var(--muted)' }}>
                        {fmtPowerOnHours(device.power_on_hours)}
                      </div></>
                  : '—'} />
        <Metric label="Démarrages"
                value={device.power_cycle_count != null
                  ? device.power_cycle_count.toLocaleString('fr-FR')
                  : '—'} />
        <Metric label="Status SMART"
                value={device.smart_status === true
                  ? <span style={{ color:'var(--success)' }}>PASSED</span>
                  : device.smart_status === false
                  ? <span style={{ color:'var(--danger)' }}>FAILED</span>
                  : '—'} />
      </div>

      {criticalAttrs.length > 0 && (
        <div>
          <div style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase',
                         letterSpacing:'.05em', marginBottom:6 }}>
            Attributs critiques
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', fontSize:11, borderCollapse:'collapse', minWidth:380 }}>
              <thead>
                <tr style={{ color:'var(--muted)' }}>
                  <th style={th2}>ID</th>
                  <th style={th2}>Nom</th>
                  <th style={{...th2, textAlign:'right'}}>Brut</th>
                </tr>
              </thead>
              <tbody>
                {criticalAttrs.map((a, i) => {
                  // Mise en valeur des valeurs anormales
                  let valueColor = 'var(--text)'
                  const rawNum = parseInt(String(a.raw).match(/^-?\d+/)?.[0] || '0')
                  if ([5, 197, 198, 199, 187, 188].includes(a.id) && rawNum > 0) {
                    valueColor = 'var(--warning)'
                  }
                  if (['critical_warning', 'media_errors'].includes(a.id) && rawNum > 0) {
                    valueColor = 'var(--danger)'
                  }
                  return (
                    <tr key={i} style={{ borderTop:'1px solid var(--border)' }}>
                      <td style={td2}>{a.id}</td>
                      <td style={td2}>{a.name}</td>
                      <td style={{...td2, textAlign:'right', color:valueColor, fontWeight: rawNum > 0 ? 600 : 400 }}>
                        {a.raw}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {otherAttrs.length > 0 && (
        <details>
          <summary style={{ cursor:'pointer', fontSize:11, color:'var(--muted)',
                            textTransform:'uppercase', letterSpacing:'.05em' }}>
            ▶ Autres attributs SMART ({otherAttrs.length})
          </summary>
          <div style={{ overflowX:'auto', marginTop:8 }}>
            <table style={{ width:'100%', fontSize:11, borderCollapse:'collapse', minWidth:480 }}>
              <thead>
                <tr style={{ color:'var(--muted)' }}>
                  <th style={th2}>ID</th>
                  <th style={th2}>Nom</th>
                  <th style={{...th2, textAlign:'right'}}>Value</th>
                  <th style={{...th2, textAlign:'right'}}>Worst</th>
                  <th style={{...th2, textAlign:'right'}}>Thresh</th>
                  <th style={th2}>Raw</th>
                </tr>
              </thead>
              <tbody>
                {otherAttrs.map((a, i) => (
                  <tr key={i} style={{ borderTop:'1px solid var(--border)' }}>
                    <td style={td2}>{a.id}</td>
                    <td style={td2}>{a.name}</td>
                    <td style={{...td2, textAlign:'right'}}>{a.value ?? '—'}</td>
                    <td style={{...td2, textAlign:'right'}}>{a.worst ?? '—'}</td>
                    <td style={{...td2, textAlign:'right'}}>{a.thresh ?? '—'}</td>
                    <td style={{...td2, color:'var(--muted)'}}>{a.raw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}


function Metric({ label, value }) {
  return (
    <div style={{ padding:'8px 10px', background:'var(--bg)', borderRadius:6 }}>
      <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase',
                     letterSpacing:'.05em' }}>{label}</div>
      <div style={{ marginTop:2 }}>{value}</div>
    </div>
  )
}


export default function SmartPanel() {
  const [devices, setDevices] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [copied,  setCopied]  = useState(false)

  const load = async () => {
    setLoading(true); setError(null)
    try { setDevices(await api.smartDevices()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const refresh = async () => {
    setLoading(true)
    try { await api.smartRefresh(); setDevices(await api.smartDevices()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Récap global
  const globalLevel = devices?.reduce((acc, d) => {
    const l = d.health?.level
    if (l === 'danger') return 'danger'
    if (l === 'warning' && acc !== 'danger') return 'warning'
    return acc
  }, 'ok')

  return (
    <div className="card" style={{ padding:0, overflow:'hidden' }}>
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        padding:'10px 14px', borderBottom:'1px solid var(--border)', flexWrap:'wrap',
      }}>
        <span style={{ fontWeight:600, fontSize:13 }}>💾 État SMART des disques</span>
        {devices && devices.length > 0 && (
          <span style={{ fontSize:11, color:'var(--muted)' }}>
            · {devices.length} disque{devices.length > 1 ? 's' : ''}
            {globalLevel === 'ok'      && <span style={{ color:'var(--success)' }}> · tous OK</span>}
            {globalLevel === 'warning' && <span style={{ color:'var(--warning)' }}> · attention</span>}
            {globalLevel === 'danger'  && <span style={{ color:'var(--danger)' }}> · ⚠ DANGER</span>}
          </span>
        )}
        <span style={{ flex:1 }} />
        {devices && devices.length > 0 && (
          <>
            <button className="btn-ghost" onClick={async () => {
              const ok = await copyToClipboard(JSON.stringify(devices, null, 2))
              if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
            }} style={{ fontSize:11, padding:'4px 10px' }}>
              {copied ? '✓ Copié' : '📋 Copier JSON'}
            </button>
            <button className="btn-ghost"
              onClick={() => downloadJson({ generated_at: new Date().toISOString(), devices },
                                          `smart-devices-${new Date().toISOString().slice(0,10)}.json`)}
              style={{ fontSize:11, padding:'4px 10px' }}>⬇ Télécharger</button>
          </>
        )}
        <button className="btn-ghost" onClick={refresh} disabled={loading}
                style={{ fontSize:12, padding:'4px 10px' }}>
          {loading ? '⟳ Lecture…' : '↻ Actualiser'}
        </button>
      </div>

      <div style={{ padding:14 }}>
        {loading && !devices && <div style={{ color:'var(--muted)' }}>Lecture des disques…</div>}
        {error && (
          <div style={{ padding:10, background:'#450a0a', color:'var(--danger)',
                         borderRadius:6, fontSize:12 }}>
            Erreur : {error}
          </div>
        )}
        {devices && devices.length === 0 && (
          <div style={{ color:'var(--muted)', fontSize:12 }}>
            Aucun disque avec données SMART détecté. Vérifie que le container backend
            tourne en mode <code>privileged: true</code>.
          </div>
        )}
        {devices && devices.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {devices.map(d => <DeviceCard key={d.device} device={d} />)}
          </div>
        )}
      </div>
    </div>
  )
}

const th2 = { textAlign:'left', padding:'4px 8px', fontSize:10, fontWeight:600 }
const td2 = { padding:'3px 8px', fontFamily:'var(--mono)' }
