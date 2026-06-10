// Onglet « Cloud » — pilotage de la synchro rclone vers pCloud.
//
// Deux blocs :
//   1. Panneau de synchro : choisir source + destination, lancer/arrêter,
//      suivre la progression.
//   2. (à venir étape 4) Panneau de santé rclone.
//
// La synchro est un transfert DIRECT local → pcloud:, qui ne passe pas par
// le montage FUSE. Le mode « miroir » (efface le surplus côté pCloud) est
// volontairement présenté comme une option à risque et désactivé par défaut.
import { useState, useEffect, useCallback, useRef } from 'react'
import { api, fmtSize, fmtEta, fmtNum } from '../api.js'

const RC_COLOR = {
  IDLE:    '#64748b',
  RUNNING: '#22c55e',
  DONE:    '#06b6d4',
  ERROR:   '#ef4444',
  ABORTED: '#f59e0b',
}

export default function TabCloud({ status }) {
  // ── Sélection ───────────────────────────────────────────────────────
  const [paths,   setPaths]   = useState({ disks: [], network: [] })
  const [source,  setSource]  = useState('')
  const [destDirs, setDestDirs] = useState(null)   // null = pas encore chargé
  const [dest,    setDest]    = useState('00_PcloudMusic')
  const [dryRun,  setDryRun]  = useState(true)
  const [mirror,  setMirror]  = useState(false)
  // Mode de synchro : 'fast' = d'après le dernier scan ; 'full' = rclone compare.
  const [mode,    setMode]    = useState('fast')
  const [scanInfo, setScanInfo] = useState(null)   // aperçu du dernier scan

  // ── État runtime ────────────────────────────────────────────────────
  const [rc,      setRc]      = useState(null)
  const [busy,    setBusy]    = useState(false)
  const [msg,     setMsg]     = useState(null)
  const [dirsErr, setDirsErr] = useState(null)
  const [health,  setHealth]  = useState(null)
  const [healthBusy, setHealthBusy] = useState(false)

  // Opération ZimaCompare en cours (scan/sync) → on bloque la synchro Cloud.
  const zimaBusy = status?.app_state &&
                   !['IDLE', 'ERROR'].includes(status.app_state)

  function notify(text, ok = true) {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 5000)
  }

  // ── Chargement initial : chemins locaux + dossiers pCloud ───────────
  useEffect(() => {
    api.discover()
      .then(d => setPaths({ disks: d.disks || [], network: d.network || [] }))
      .catch(() => {})
    loadDestDirs()
    loadHealth()
    loadScanInfo()
  }, [])

  function loadScanInfo() {
    api.rcloneScanSummary()
      .then(info => {
        setScanInfo(info)
        // En mode rapide, pré-remplir source et destination avec le couple
        // du scan : l'utilisateur n'a pas à retaper des chemins, et la source
        // correspondra exactement (le garde-fou de concordance l'exige).
        if (info && info.available) {
          if (info.source) setSource(info.source)
          if (info.target) {
            // La cible du scan est un chemin local (/network/pCloud/X) ;
            // on en extrait le sous-dossier pCloud pour le champ destination.
            const m = info.target.match(/\/network\/pCloud\/(.+)$/)
            if (m) setDest(m[1])
          }
        }
      })
      .catch(() => setScanInfo(null))
  }

  function loadDestDirs() {
    setDirsErr(null)
    api.rcloneLsd()
      .then(r => setDestDirs(r.dirs || []))
      .catch(e => {
        setDestDirs([])
        setDirsErr(e.message)
      })
  }

  function loadHealth() {
    setHealthBusy(true)
    api.rcloneHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setHealthBusy(false))
  }

  // ── Polling de l'état rclone ────────────────────────────────────────
  const pollRc = useCallback(async () => {
    try {
      const s = await api.rcloneStatus()
      setRc(s)
    } catch {
      setRc(null)
    }
  }, [])

  useEffect(() => {
    pollRc()
    const id = setInterval(pollRc, 2000)
    return () => clearInterval(id)
  }, [pollRc])

  const running = rc?.rclone_state === 'RUNNING'

  // ── Actions ─────────────────────────────────────────────────────────
  async function doStart() {
    if (!source) return notify('Choisissez un dossier source.', false)
    if (!dest)   return notify('Choisissez une destination pCloud.', false)

    // ── Mode rapide : transfert d'après le dernier scan ───────────────
    if (mode === 'fast') {
      if (!scanInfo || !scanInfo.available) {
        return notify('Aucun scan exploitable — lancez d\'abord un scan, ' +
                      'puis revenez ici.', false)
      }
      if (scanInfo.to_sync_count === 0) {
        return notify('Le dernier scan ne signale aucun fichier à ' +
                      'transférer — rien à faire.', false)
      }
      if (scanInfo.stale) {
        const ok = confirm(
          '⚠ SCAN ANCIEN\n\n' +
          `Le dernier scan date de ${scanInfo.scan_age_hours} h. Il ne ` +
          'reflète peut-être plus l\'état réel des fichiers.\n\n' +
          'Lancer quand même le mode rapide sur ce scan ?'
        )
        if (!ok) return
      }
      try {
        setBusy(true)
        const r = await api.rcloneSyncFromScan({ source, dest, dry_run: dryRun })
        notify(`Mise à niveau rapide lancée — ${r.files_count} fichier(s)` +
               `${r.dry_run ? ' (simulation)' : ''}.`)
        pollRc()
      } catch (e) {
        notify(e.message, false)
      } finally {
        setBusy(false)
      }
      return
    }

    // ── Mode complet : rclone compare lui-même ────────────────────────
    if (mirror && !dryRun) {
      const ok = confirm(
        '⚠ MODE MIROIR\n\n' +
        'Le mode miroir EFFACE sur pCloud tout fichier qui n\'existe plus ' +
        'dans le dossier source.\n\n' +
        'Vérifiez que le panneau de santé rclone est au vert avant ' +
        'd\'utiliser ce mode : si le montage est instable, des fichiers ' +
        'pourraient être supprimés à tort.\n\n' +
        'Confirmer le lancement en mode miroir ?'
      )
      if (!ok) return
    }
    try {
      setBusy(true)
      const r = await api.rcloneSync({ source, dest, dry_run: dryRun, mirror })
      notify(`Synchro complète lancée (${r.operation === 'sync' ? 'miroir' : 'copie'}` +
             `${r.dry_run ? ', simulation' : ''}).`)
      pollRc()
    } catch (e) {
      notify(e.message, false)
    } finally {
      setBusy(false)
    }
  }

  async function doAbort() {
    if (!confirm('Arrêter la synchro en cours ?')) return
    try {
      setBusy(true)
      await api.rcloneAbort()
      notify('Arrêt demandé.')
      pollRc()
    } catch (e) {
      notify(e.message, false)
    } finally {
      setBusy(false)
    }
  }

  // Toutes les destinations connues, pour la datalist (saisie libre + liste).
  const localSuggestions = [...new Set([
    ...(paths.disks || []),
    ...(paths.network || []),
  ])]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── En-tête explicatif ─────────────────────────────────────── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>☁ Synchronisation pCloud</span>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--muted)' }}>
              Transfert direct via rclone — ne passe pas par le montage
            </span>
          </div>
          {rc && (
            <span className="badge" style={{
              background: (RC_COLOR[rc.rclone_state] || '#64748b') + '22',
              color: RC_COLOR[rc.rclone_state] || '#64748b',
            }}>
              {running && '⟳ '}{rc.rclone_state}
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55,
                     marginTop: 10 }}>
          Cette synchro copie un dossier local vers pCloud en flux direct
          (<code>rclone</code>). Contrairement à un scan ZimaCompare, elle
          n'écrit pas à travers le montage <code>/network/pCloud</code> — le
          disque système de la ZimaBoard n'est pas sollicité.
        </p>
      </div>

      {/* ── Message ─────────────────────────────────────────────────── */}
      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 6, fontSize: 12,
                       background: msg.ok ? '#14532d' : '#450a0a',
                       color:     msg.ok ? '#86efac' : '#fca5a5' }}>
          {msg.text}
        </div>
      )}

      {/* ── Garde-fou : opération ZimaCompare en cours ──────────────── */}
      {zimaBusy && (
        <div style={{ padding: '10px 14px', background: '#422006',
                       borderLeft: '3px solid var(--warning)', borderRadius: 6,
                       fontSize: 12, color: '#fcd34d' }}>
          ⚠ Une opération ZimaCompare ({status.app_state}) est en cours. La
          synchro Cloud est indisponible jusqu'à sa fin.
        </div>
      )}

      {/* ── Panneau de synchro ──────────────────────────────────────── */}
      <div className="card">
        <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 14,
                      letterSpacing: '.05em', textTransform: 'uppercase',
                      color: 'var(--muted)' }}>
          Nouvelle synchronisation
        </h4>

        {/* Choix du mode */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14,
                       flexWrap: 'wrap' }}>
          <button onClick={() => setMode('fast')} disabled={running}
                  className={mode === 'fast' ? 'btn-primary' : 'btn-ghost'}
                  style={{ fontSize: 12, flex: 1, minWidth: 200 }}>
            ⚡ Mise à niveau rapide
          </button>
          <button onClick={() => setMode('full')} disabled={running}
                  className={mode === 'full' ? 'btn-primary' : 'btn-ghost'}
                  style={{ fontSize: 12, flex: 1, minWidth: 200 }}>
            🔄 Synchro complète
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14,
                     lineHeight: 1.5 }}>
          {mode === 'fast'
            ? 'Transfère uniquement les fichiers que le dernier scan ' +
              'ZimaCompare a identifiés comme nouveaux ou différents. ' +
              'Très rapide — pas de re-comparaison.'
            : 'rclone compare lui-même la totalité de la source et de la ' +
              'cible. Plus lent, mais ne dépend d\'aucun scan préalable et ' +
              'permet le mode miroir.'}
        </p>

        {/* Aperçu du dernier scan — mode rapide uniquement */}
        {mode === 'fast' && (
          <div style={{ padding: '10px 12px', borderRadius: 6, marginBottom: 14,
                         background: 'var(--bg-soft, #1e293b)',
                         border: '1px solid var(--border, #334155)' }}>
            {!scanInfo ? (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Lecture du dernier scan…
              </span>
            ) : !scanInfo.available ? (
              <span style={{ fontSize: 12, color: 'var(--warning)' }}>
                ⚠ {scanInfo.reason || 'Aucun scan exploitable.'} Lancez un scan
                dans l'onglet « Scan & Sync », puis revenez ici.
              </span>
            ) : (
              <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                <div>
                  <strong style={{ color: 'var(--text)' }}>
                    {scanInfo.to_sync_count}
                  </strong>{' '}
                  fichier(s) à transférer d'après le dernier scan
                  {' '}<span style={{ color: 'var(--muted)' }}>
                    ({scanInfo.new_count} nouveau(x), {scanInfo.different_count}
                    {' '}modifié(s))
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11,
                               color: 'var(--muted)' }}>
                  {scanInfo.source} → {scanInfo.target}
                </div>
                <div style={{ fontSize: 11,
                               color: scanInfo.stale ? 'var(--warning)'
                                                      : 'var(--muted)' }}>
                  Scan du {(scanInfo.scanned_at || '').replace('T', ' ')}
                  {scanInfo.scan_age_hours != null &&
                    ` (il y a ${scanInfo.scan_age_hours} h)`}
                  {scanInfo.stale && ' — ⚠ ancien, envisagez un nouveau scan'}
                </div>
                <button className="btn-ghost" onClick={loadScanInfo}
                        disabled={running}
                        style={{ fontSize: 11, padding: '3px 8px',
                                  marginTop: 4 }}>
                  ↻ Actualiser
                </button>
              </div>
            )}
          </div>
        )}

        {/* Source */}
        <div style={{ marginBottom: 14 }}>
          <label>Dossier source (local)</label>
          <input type="text" value={source} list="cloud-src-paths"
                 onChange={e => setSource(e.target.value)}
                 disabled={running}
                 placeholder="/disks/… ou /network/…"
                 style={{ marginTop: 6, fontFamily: 'var(--mono)' }} />
          <datalist id="cloud-src-paths">
            {localSuggestions.map(p => <option key={p} value={p} />)}
          </datalist>
        </div>

        {/* Destination */}
        <div style={{ marginBottom: 14 }}>
          <label>Destination pCloud</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6,
                         alignItems: 'stretch', flexWrap: 'wrap' }}>
            <input type="text" value={dest} list="cloud-dest-dirs"
                   onChange={e => setDest(e.target.value)}
                   disabled={running}
                   placeholder="00_PcloudMusic ou pcloud:chemin/sous-dossier"
                   style={{ flex: 1, minWidth: 240, fontFamily: 'var(--mono)' }} />
            <datalist id="cloud-dest-dirs">
              {(destDirs || []).map(d => <option key={d} value={d} />)}
            </datalist>
            <button className="btn-ghost" onClick={loadDestDirs}
                    disabled={running}
                    style={{ fontSize: 11, padding: '4px 10px' }}>
              ↻ Recharger la liste
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            {destDirs === null
              ? 'Chargement des dossiers pCloud…'
              : dirsErr
                ? <span style={{ color: 'var(--danger)' }}>
                    ⚠ Liste indisponible ({dirsErr}). Vous pouvez saisir le
                    chemin manuellement.
                  </span>
                : `${destDirs.length} dossier(s) à la racine de pCloud — ` +
                  `choisissez dans la liste ou saisissez un chemin.`}
          </p>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap',
                       marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                           textTransform: 'none', letterSpacing: 0,
                           cursor: running ? 'default' : 'pointer',
                           color: 'var(--text)', fontSize: 13 }}>
            <input type="checkbox" checked={dryRun} disabled={running}
                   onChange={e => setDryRun(e.target.checked)}
                   style={{ width: 'auto' }} />
            Simulation (dry-run) — aucune écriture
          </label>
          {mode === 'full' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                             textTransform: 'none', letterSpacing: 0,
                             cursor: running ? 'default' : 'pointer',
                             color: mirror ? 'var(--warning)' : 'var(--text)',
                             fontSize: 13 }}>
              <input type="checkbox" checked={mirror} disabled={running}
                     onChange={e => setMirror(e.target.checked)}
                     style={{ width: 'auto' }} />
              Mode miroir — efface sur pCloud le surplus ⚠
            </label>
          )}
        </div>

        {mode === 'full' && mirror && (
          <div style={{ padding: '8px 12px', background: '#422006',
                         borderLeft: '3px solid var(--warning)', borderRadius: 6,
                         fontSize: 11, color: '#fcd34d', marginBottom: 14 }}>
            Le mode miroir supprime sur pCloud tout fichier absent de la source.
            Recommandé uniquement après vérification du montage (panneau de
            santé à venir). Par défaut, la synchro se fait en mode copie, qui
            n'efface rien.
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!running ? (
            <button className="btn-primary" onClick={doStart}
                    disabled={busy || zimaBusy || !source || !dest ||
                      (mode === 'fast' &&
                        (!scanInfo || !scanInfo.available ||
                         scanInfo.to_sync_count === 0))}>
              {mode === 'fast'
                ? (dryRun ? '▶ Simuler la mise à niveau'
                          : '▶ Lancer la mise à niveau rapide')
                : (dryRun ? '▶ Simuler la synchro complète'
                          : '▶ Lancer la synchro complète')}
            </button>
          ) : (
            <button className="btn-danger" onClick={doAbort} disabled={busy}>
              ■ Arrêter la synchro
            </button>
          )}
        </div>
      </div>

      {/* ── Progression ─────────────────────────────────────────────── */}
      {rc && rc.rclone_state !== 'IDLE' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between',
                         alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {rc.operation === 'sync' ? 'Miroir' : 'Copie'}
              {rc.dry_run && ' (simulation)'}
            </span>
            <span className="badge" style={{
              background: (RC_COLOR[rc.rclone_state] || '#64748b') + '22',
              color: RC_COLOR[rc.rclone_state] || '#64748b',
            }}>
              {rc.rclone_state}
            </span>
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)',
                         fontFamily: 'var(--mono)', marginBottom: 8 }}>
            {rc.source} → {rc.dest}
          </div>

          {/* Bandeau de phase — évite que le dry-run paraisse figé :
              en comparaison, la barre d'octets est à 100 % alors que le
              travail (vérification des fichiers) continue. */}
          {running && (
            <div style={{ fontSize: 12, marginBottom: 6,
                           color: rc.phase === 'transferring'
                                  ? 'var(--accent)' : 'var(--warning)' }}>
              {rc.phase === 'transferring' ? (
                <>⟳ Transfert en cours…</>
              ) : (
                <>
                  ⟳ Comparaison des fichiers en cours…
                  {' '}<strong style={{ color: 'var(--text)' }}>
                    {fmtNum(rc.checks)}
                  </strong> vérifié(s)
                  {rc.dry_run &&
                    ' — la barre à 100 % est normale en simulation'}
                </>
              )}
            </div>
          )}

          <div className="progress-bar-track">
            <div className="progress-bar-fill"
                 style={{
                   width: `${rc.progress || 0}%`,
                   // En phase de comparaison, la barre n'est pas
                   // significative : on l'atténue pour ne pas faire croire
                   // que c'est « presque fini ».
                   opacity: running && rc.phase === 'checking' ? 0.35 : 1,
                 }} />
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap',
                         fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            <span>
              <strong style={{ color: 'var(--text)' }}>
                {rc.bytes_total > 0
                  ? `${fmtSize(rc.bytes_done)} / ${fmtSize(rc.bytes_total)}`
                  : fmtSize(rc.bytes_done)}
              </strong>
              {rc.bytes_total > 0 && ` (${rc.progress}%)`}
            </span>
            {rc.speed_bps > 0 && (
              <>
                <span style={{ opacity: .6 }}>·</span>
                <span>{fmtSize(rc.speed_bps)}/s</span>
              </>
            )}
            {rc.eta_seconds > 0 && (
              <>
                <span style={{ opacity: .6 }}>·</span>
                <span>ETA {fmtEta(rc.eta_seconds)}</span>
              </>
            )}
            {rc.checks > 0 && (
              <>
                <span style={{ opacity: .6 }}>·</span>
                <span>{fmtNum(rc.checks)} vérifié(s)</span>
              </>
            )}
            <span style={{ opacity: .6 }}>·</span>
            <span>{fmtNum(rc.transfers)} transféré(s)</span>
            {rc.errors > 0 && (
              <>
                <span style={{ opacity: .6 }}>·</span>
                <span style={{ color: 'var(--danger)' }}>
                  {fmtNum(rc.errors)} erreur(s)
                </span>
              </>
            )}
          </div>

          {rc.current_file && running && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)',
                           fontFamily: 'var(--mono)', whiteSpace: 'nowrap',
                           overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ⟳ {rc.current_file}
            </div>
          )}

          {rc.rclone_state === 'ERROR' && rc.error && (
            <div style={{ marginTop: 10, padding: '8px 12px',
                           background: '#450a0a', borderRadius: 6,
                           fontSize: 12, color: '#fca5a5' }}>
              {rc.error}
            </div>
          )}

          {rc.rclone_state === 'DONE' && (
            <div style={{ marginTop: 10, padding: '8px 12px',
                           background: '#14532d', borderRadius: 6,
                           fontSize: 12, color: '#86efac' }}>
              ✓ Synchro terminée
              {rc.dry_run && ' (simulation — aucune écriture réelle)'}.
              {rc.finished_at && ` ${rc.finished_at.replace('T', ' ')}`}
            </div>
          )}

          {rc.rclone_state === 'ABORTED' && (
            <div style={{ marginTop: 10, padding: '8px 12px',
                           background: '#422006', borderRadius: 6,
                           fontSize: 12, color: '#fcd34d' }}>
              Synchro interrompue. Les fichiers déjà copiés sont conservés ;
              vous pouvez relancer pour terminer.
            </div>
          )}
        </div>
      )}

      {/* ── Panneau de santé rclone ─────────────────────────────────── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', marginBottom: 12,
                       flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>🩺 Santé rclone</span>
            {health && (
              <span className={health.all_ok
                                 ? 'badge badge-green'
                                 : 'badge badge-yellow'}
                    style={{ marginLeft: 10 }}>
                {health.all_ok ? 'Tout est OK' : 'Attention'}
              </span>
            )}
          </div>
          <button className="btn-ghost" onClick={loadHealth}
                  disabled={healthBusy}
                  style={{ fontSize: 11, padding: '4px 10px' }}>
            {healthBusy ? '…' : '↻ Rafraîchir'}
          </button>
        </div>

        {!health ? (
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            {healthBusy ? 'Contrôle en cours…' : 'Bilan indisponible.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <HealthRow
              label="Démon rclone"
              ok={health.demon?.ok}
              detail={health.demon?.detail} />
            <HealthRow
              label="Montage /network/pCloud"
              ok={health.mount?.ok}
              warn={health.mount?.warn}
              detail={health.mount?.detail} />
            <HealthRow
              label="Remote pCloud"
              ok={health.remote?.ok}
              detail={
                health.remote?.ok && health.remote?.total_bytes
                  ? `${fmtSize(health.remote.used_bytes)} utilisés / ` +
                    `${fmtSize(health.remote.total_bytes)} ` +
                    `(${fmtSize(health.remote.free_bytes)} libres)`
                  : health.remote?.detail
              } />
            {health.checked_at && (
              <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                Dernier contrôle : {health.checked_at.replace('T', ' ')}
              </p>
            )}
            {!health.mount?.ok && (
              <div style={{ padding: '8px 12px', background: '#422006',
                             borderLeft: '3px solid var(--warning)',
                             borderRadius: 6, fontSize: 11, color: '#fcd34d',
                             marginTop: 4 }}>
                Tant que le montage n'est pas confirmé sain, évitez le mode
                miroir : un montage tombé pourrait faire croire que des
                fichiers ont disparu et déclencher des suppressions.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Une ligne du panneau de santé : pastille verte/orange/rouge + libellé + détail.
function HealthRow({ label, ok, warn, detail }) {
  // warn = monté mais anormal (ex : vide) → orange, ni vert ni rouge.
  const color = ok ? 'var(--success)'
                   : warn ? 'var(--warning)'
                   : 'var(--danger)'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10,
                   fontSize: 12 }}>
      <span style={{ fontSize: 13, color }}>●</span>
      <span style={{ fontWeight: 600, minWidth: 180, color: 'var(--text)' }}>
        {label}
      </span>
      <span style={{ color: ok ? 'var(--muted)' : color, flex: 1 }}>
        {detail || (ok ? 'OK' : 'indisponible')}
      </span>
    </div>
  )
}
