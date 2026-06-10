import { useState, useEffect } from 'react'
import { api, fmtSize } from '../api.js'

const STATUS_FILTERS = [
  { id:'',          label:'Tous',       color:'var(--muted)' },
  { id:'new',       label:'Nouveaux',   color:'var(--success)' },
  { id:'different', label:'Modifiés',   color:'var(--warning)' },
  { id:'deleted',   label:'Supprimés',  color:'var(--danger)' },
  { id:'identical', label:'Identiques', color:'var(--muted)' },
  // v3.13 — cas spécial : alimenté par un endpoint séparé
  { id:'ignored',   label:'Ignorés',    color:'#a78bfa', special:true },
]

const STATUS_LABEL = {
  new:       { txt:'NOUVEAU',  color:'var(--success)' },
  different: { txt:'MODIFIÉ',  color:'var(--warning)' },
  deleted:   { txt:'SUPPRIMÉ', color:'var(--danger)'  },
  identical: { txt:'IDENTIQUE',color:'var(--muted)'   },
  error:     { txt:'ERREUR',   color:'var(--danger)'  },
}

export default function ScanResults() {
  const [filter, setFilter] = useState('')
  const [data,   setData]   = useState({ items:[], total:0 })
  const [ignoredMeta, setIgnoredMeta] = useState(null)
  const [diffRep, setDiffRep] = useState(null)   // rapport des fichiers différents
  const [tgtRep,  setTgtRep]  = useState(null)   // rapport du contrôle ciblé
  const [tgtBusy, setTgtBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  const isIgnored = filter === 'ignored'
  const isDiff    = filter === 'different'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setIgnoredMeta(null)

    // Rapport de classification — uniquement pour le filtre « Modifiés ».
    if (filter === 'different') {
      api.diffReport()
        .then(rep => { if (!cancelled) setDiffRep(rep) })
        .catch(() => { if (!cancelled) setDiffRep(null) })
      // Rapport d'un éventuel contrôle ciblé déjà effectué.
      api.targetedReport()
        .then(rep => { if (!cancelled) setTgtRep(rep) })
        .catch(() => { if (!cancelled) setTgtRep(null) })
    } else {
      setDiffRep(null)
      setTgtRep(null)
    }

    if (filter === 'ignored') {
      // v3.13 — endpoint dédié à la liste des fichiers filtrés par .zimaignore
      api.ignoredFiles({ limit: 1000, offset: 0 })
        .then(res => {
          if (cancelled) return
          setData({ items: res.items || [], total: res.total || 0 })
          setIgnoredMeta({
            capped: res.capped, listed: res.listed,
            generated_at: res.generated_at, cap: res.cap,
          })
        })
        .catch(() => { if (!cancelled) setData({ items:[], total:0 }) })
        .finally(() => { if (!cancelled) setLoading(false) })
    } else {
      api.scanResults({ status: filter || '', limit: 500, offset: 0 })
        .then(res => { if (!cancelled) setData(res) })
        .catch(() => { if (!cancelled) setData({ items:[], total:0 }) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    return () => { cancelled = true }
  }, [filter])

  // Lance le contrôle ciblé niveau 3 sur les fichiers différents.
  async function runTargetedCheck() {
    const ok = confirm(
      'CONTRÔLE APPROFONDI (niveau 3)\n\n' +
      'Cette vérification recalcule l\'empreinte COMPLÈTE de chaque fichier ' +
      'différent, des deux côtés. Sur une cible pCloud, cela télécharge ' +
      'l\'intégralité des fichiers concernés — l\'opération peut durer ' +
      'plusieurs minutes, voire dizaines de minutes.\n\n' +
      'Lancer le contrôle approfondi ?'
    )
    if (!ok) return
    try {
      setTgtBusy(true)
      const st = await api.status()
      if (!st.source || !st.target) {
        alert('Source ou cible du dernier scan introuvable.')
        return
      }
      await api.targetedCheck({ source: st.source, target: st.target })
      alert('Contrôle approfondi lancé. Suivez la progression en haut de ' +
            'l\'application (état du scan). Revenez ici ensuite et ' +
            'actualisez pour voir le rapport.')
    } catch (e) {
      alert('Échec du lancement : ' + e.message)
    } finally {
      setTgtBusy(false)
    }
  }

  function reloadTargeted() {
    api.targetedReport()
      .then(setTgtRep)
      .catch(() => setTgtRep(null))
  }

  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
        {STATUS_FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding:'5px 10px', fontSize:12, borderRadius:4,
            background: filter === f.id ? f.color + '33' : 'var(--bg)',
            color:      filter === f.id ? f.color : 'var(--muted)',
            border:     `1px solid ${filter === f.id ? f.color : 'var(--border)'}`,
            textTransform:'none', letterSpacing:0, cursor:'pointer',
            ...(f.special ? { fontStyle: filter === f.id ? 'normal' : 'italic' } : {}),
          }}>{f.label}</button>
        ))}
      </div>

      {/* Bandeau info pour le mode Ignorés */}
      {isIgnored && ignoredMeta && (
        <div style={{ fontSize:11, color:'var(--muted)', marginBottom:8, padding:'8px 10px',
                       background:'#1e1b2e', borderLeft:'3px solid #a78bfa', borderRadius:4 }}>
          Entrées écartées par <code>.zimaignore</code> lors du dernier scan.
          {ignoredMeta.generated_at &&
            ` Scan du ${ignoredMeta.generated_at.replace('T',' ')}.`}
          {ignoredMeta.capped &&
            ` ⚠ Liste plafonnée à ${(ignoredMeta.cap || 0).toLocaleString('fr-FR')} entrées — le compteur total reste exact.`}
        </div>
      )}

      {/* Bandeau de classification — mode « Modifiés » */}
      {isDiff && diffRep && diffRep.available && diffRep.total_different > 0 && (
        <div style={{ fontSize:11, marginBottom:8, padding:'8px 10px',
                       background:'#2a2410', borderLeft:'3px solid var(--warning)',
                       borderRadius:4 }}>
          <div style={{ display:'flex', justifyContent:'space-between',
                         alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <span style={{ color:'var(--text)' }}>
              <strong>{diffRep.total_different}</strong> fichier(s) modifié(s),
              répartis par type d'écart :
            </span>
            <a href="/api/diff-report.csv" download
               style={{ fontSize:11, color:'var(--accent)',
                         textDecoration:'none', border:'1px solid var(--accent)',
                         borderRadius:4, padding:'3px 8px' }}>
              ⭳ Exporter en CSV
            </a>
          </div>
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginTop:6,
                         color:'var(--muted)' }}>
            <span>
              <strong style={{ color:'#f87171' }}>{diffRep.by_kind.size || 0}</strong>
              {' '}taille différente
            </span>
            <span>
              <strong style={{ color:'#fbbf24' }}>{diffRep.by_kind.content || 0}</strong>
              {' '}contenu divergent
            </span>
            <span>
              <strong style={{ color:'#a78bfa' }}>{diffRep.by_kind.read_error || 0}</strong>
              {' '}lecture cible impossible
            </span>
            {(diffRep.by_kind.other || 0) > 0 && (
              <span>
                <strong>{diffRep.by_kind.other}</strong> écart indéterminé
              </span>
            )}
          </div>
          {(diffRep.by_kind.read_error || 0) > 0 && (
            <div style={{ marginTop:6, color:'#fcd34d' }}>
              ⚠ « Lecture cible impossible » : la cible n'a pas pu être lue
              (montage instable ?). Ces fichiers ne sont pas forcément
              différents — un contrôle approfondi le confirmera.
            </div>
          )}
          {/* Contrôle ciblé niveau 3 */}
          <div style={{ marginTop:8, paddingTop:8,
                         borderTop:'1px solid var(--border)',
                         display:'flex', alignItems:'center', gap:10,
                         flexWrap:'wrap' }}>
            <button onClick={runTargetedCheck} disabled={tgtBusy}
                    style={{ fontSize:11, padding:'4px 10px', borderRadius:4,
                              background:'var(--accent)', color:'#fff',
                              border:'none', cursor:'pointer' }}>
              {tgtBusy ? '…' : '🔬 Contrôle approfondi (niveau 3)'}
            </button>
            <span style={{ color:'var(--muted)' }}>
              Recalcule l'empreinte complète de ces fichiers pour confirmer
              les vraies différences. Long sur pCloud.
            </span>
          </div>
        </div>
      )}

      {/* Rapport du contrôle ciblé (si déjà effectué) */}
      {isDiff && tgtRep && tgtRep.available && (
        <div style={{ fontSize:11, marginBottom:8, padding:'8px 10px',
                       background:'#0f2027', borderLeft:'3px solid var(--accent)',
                       borderRadius:4 }}>
          <div style={{ display:'flex', justifyContent:'space-between',
                         alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <span style={{ color:'var(--text)' }}>
              <strong>Rapport du contrôle approfondi</strong>
              {tgtRep.generated_at &&
                ` — ${tgtRep.generated_at.replace('T',' ')}`}
            </span>
            <span style={{ display:'flex', gap:8 }}>
              <button onClick={reloadTargeted}
                      style={{ fontSize:11, padding:'3px 8px', borderRadius:4,
                                background:'var(--bg)', color:'var(--muted)',
                                border:'1px solid var(--border)', cursor:'pointer' }}>
                ↻ Actualiser
              </button>
              <a href="/api/targeted-report.csv" download
                 style={{ fontSize:11, color:'var(--accent)',
                           textDecoration:'none', border:'1px solid var(--accent)',
                           borderRadius:4, padding:'3px 8px' }}>
                ⭳ CSV
              </a>
            </span>
          </div>
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginTop:6,
                         color:'var(--muted)' }}>
            <span>
              <strong style={{ color:'var(--success)' }}>
                {tgtRep.by_verdict.identical || 0}
              </strong> confirmé(s) identique(s)
            </span>
            <span>
              <strong style={{ color:'#f87171' }}>
                {tgtRep.by_verdict.different || 0}
              </strong> confirmé(s) différent(s)
            </span>
            <span>
              <strong style={{ color:'#fbbf24' }}>
                {tgtRep.by_verdict.unreadable || 0}
              </strong> illisible(s)
            </span>
          </div>
          {(tgtRep.by_verdict.identical || 0) > 0 && (
            <div style={{ marginTop:6, color:'#86efac' }}>
              ✓ Les fichiers « confirmés identiques » étaient des faux positifs
              du scan rapide : leur contenu est en réalité identique.
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ color:'var(--muted)', fontSize:12 }}>Chargement…</div>}

      {!loading && data.items.length === 0 && (
        <div style={{ color:'var(--muted)', fontSize:12, padding:12, background:'var(--bg)', borderRadius:6 }}>
          {isIgnored
            ? 'Aucun fichier ignoré lors du dernier scan (ou aucun scan effectué).'
            : 'Aucun résultat pour ce filtre.'}
        </div>
      )}

      {!loading && data.items.length > 0 && (
        <>
          <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>
            {data.items.length >= data.total
              ? `${data.total.toLocaleString('fr-FR')} entrée(s)`
              : `Affichage de ${data.items.length.toLocaleString('fr-FR')} sur ${data.total.toLocaleString('fr-FR')} entrée(s)`}
          </div>
          <div style={{ maxHeight:380, overflowY:'auto', overflowX:'auto',
                         border:'1px solid var(--border)', borderRadius:6 }}>
            {isIgnored ? <IgnoredTable items={data.items} />
                       : <ResultsTable items={data.items} />}
          </div>
        </>
      )}
    </div>
  )
}


// Table standard (new / different / deleted / identical)
function ResultsTable({ items }) {
  return (
    <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse', minWidth:400 }}>
      <thead style={{ position:'sticky', top:0, background:'var(--surface)' }}>
        <tr>
          <th style={th}>Statut</th>
          <th style={th}>Chemin</th>
          <th style={{...th, textAlign:'right'}}>Source</th>
          <th style={{...th, textAlign:'right'}}>Cible</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r, i) => {
          const lbl = STATUS_LABEL[r.status] || { txt:r.status, color:'var(--muted)' }
          return (
            <tr key={i} style={{ borderTop:'1px solid var(--border)' }}>
              <td style={td}>
                <span style={{ color:lbl.color, fontWeight:600, fontSize:10, letterSpacing:'.05em' }}>
                  {lbl.txt}
                </span>
                {r.is_dir && <span style={{ color:'var(--muted)', marginLeft:6, fontSize:10 }}>📁</span>}
              </td>
              <td style={{...td, fontFamily:'var(--mono)', wordBreak:'break-all'}}>{r.relative_path}</td>
              <td style={{...td, textAlign:'right', fontFamily:'var(--mono)', color:'var(--muted)'}}>
                {r.is_dir ? '—' : fmtSize(r.source_size)}
              </td>
              <td style={{...td, textAlign:'right', fontFamily:'var(--mono)', color:'var(--muted)'}}>
                {r.is_dir ? '—' : fmtSize(r.target_size)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}


// Table spéciale pour les fichiers ignorés (v3.13)
function IgnoredTable({ items }) {
  return (
    <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse', minWidth:480 }}>
      <thead style={{ position:'sticky', top:0, background:'var(--surface)' }}>
        <tr>
          <th style={th}>Type</th>
          <th style={th}>Chemin</th>
          <th style={th}>Pattern</th>
          <th style={th}>Côté</th>
          <th style={{...th, textAlign:'right'}}>Taille</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r, i) => (
          <tr key={i} style={{ borderTop:'1px solid var(--border)' }}>
            <td style={td}>
              <span style={{ fontSize:13 }}>{r.is_dir ? '📁' : '📄'}</span>
            </td>
            <td style={{...td, fontFamily:'var(--mono)', wordBreak:'break-all'}}>
              {r.relative_path}{r.is_dir ? '/' : ''}
            </td>
            <td style={td}>
              {r.pattern
                ? <code style={{ background:'#1e1b2e', color:'#c4b5fd', padding:'1px 6px',
                                 borderRadius:3, fontSize:11 }}>{r.pattern}</code>
                : <span style={{ color:'var(--muted)', fontSize:11 }}>&mdash;</span>}
            </td>
            <td style={{...td, color:'var(--muted)', fontSize:11}}>
              {r.side === 'source' ? 'Source' : r.side === 'cible' ? 'Cible' : r.side}
            </td>
            <td style={{...td, textAlign:'right', fontFamily:'var(--mono)', color:'var(--muted)'}}>
              {r.is_dir ? '—' : fmtSize(r.size)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const th = { textAlign:'left', padding:'8px 10px', fontWeight:600, fontSize:11, color:'var(--muted)',
             textTransform:'uppercase', letterSpacing:'.05em', borderBottom:'1px solid var(--border)' }
const td = { padding:'6px 10px', color:'var(--text)' }
