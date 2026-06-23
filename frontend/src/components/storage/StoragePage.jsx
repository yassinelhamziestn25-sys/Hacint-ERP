import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  getStocks, getStockResume, reserveStock, releaseStock,
  getArticles, createArticle, updateArticle, deleteArticle, searchArticles,
  exportArticlesCsvUrl, importArticlesCsv,
  getMouvements, createMouvement, reverseMouvement,
  getLots, createLot, updateLot, deleteLot, searchLots,
  exportLotsCsvUrl, importLotsCsv,
  getEntrepots, createEntrepot, updateEntrepot, deleteEntrepot,
  exportEntrepotsCsvUrl, importEntrepotsCsv,
  getPlacements, createPlacement, updatePlacement, deletePlacement, searchPlacements,
  exportPlacementsCsvUrl, importPlacementsCsv,
  getCategories, createCategorie, updateCategorie, deleteCategorie,
  getTickets, createTicket,
} from '../../api/client'
import QrScannerModal, { parseQrContent } from './QrScannerModal'
import TicketPrintModal from './TicketPrintModal'
import BomMaterialsPage from './BomMaterialsPage'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—'
  return parseFloat(n).toLocaleString('fr-FR')
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'

function Badge({ color, children }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>{children}</span>
}

function StatutBadge({ statut }) {
  const map = {
    actif: 'bg-green-100 text-green-700', inactif: 'bg-gray-100 text-gray-600',
    maintenance: 'bg-yellow-100 text-yellow-700', disponible: 'bg-green-100 text-green-700',
    plein: 'bg-blue-100 text-blue-700', bloque: 'bg-red-100 text-red-700',
    perime: 'bg-red-100 text-red-700', epuise: 'bg-gray-100 text-gray-600',
    genere: 'bg-blue-100 text-blue-700', imprime: 'bg-green-100 text-green-700',
    annule: 'bg-red-100 text-red-700',
  }
  return <Badge color={map[statut] || 'bg-gray-100 text-gray-600'}>{statut}</Badge>
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children, required }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

function Input(props) { return <input className={inputCls} {...props} /> }
function Select({ children, ...props }) { return <select className={inputCls} {...props}>{children}</select> }
function Textarea(props) { return <textarea className={`${inputCls} resize-none`} rows={3} {...props} /> }

function FormActions({ onClose, saving, label = 'Enregistrer' }) {
  return (
    <div className="flex justify-end gap-3 mt-2">
      <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Annuler</button>
      <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
        {saving ? 'Enregistrement...' : label}
      </button>
    </div>
  )
}

function Pagination({ page, count, pageSize, onPage }) {
  const total = Math.ceil((count || 0) / pageSize)
  if (total <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
      <span>{count} résultats</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-100">Préc.</button>
        <span className="px-3 py-1">{page} / {total}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= total} className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-100">Suiv.</button>
      </div>
    </div>
  )
}

function ErrMsg({ error }) {
  if (!error) return null
  return <div className="text-red-600 text-sm mb-3 p-3 bg-red-50 rounded-lg">{error}</div>
}

// Turns a DRF error response into a readable French message instead of raw JSON.
function extractError(e) {
  const data = e.response?.data
  if (!data) return 'Erreur de connexion au serveur.'
  if (typeof data === 'string') return data
  if (data.error) return data.error
  if (data.detail) return data.detail
  const parts = []
  for (const [key, val] of Object.entries(data)) {
    const msg = Array.isArray(val) ? val.join(' ') : (typeof val === 'object' ? JSON.stringify(val) : String(val))
    parts.push(key === 'non_field_errors' ? msg : `${key}: ${msg}`)
  }
  return parts.length ? parts.join(' ') : 'Erreur'
}

// CSV export link + import file picker, used across Articles/Entrepôts/Placements/Lots tabs.
function CsvButtons({ exportUrl, onImport, importing }) {
  const fileRef = useRef(null)
  return (
    <>
      <a href={exportUrl} download
        className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 whitespace-nowrap text-gray-600">
        ⬇ Exporter CSV
      </a>
      <input ref={fileRef} type="file" accept=".csv" className="hidden"
        onChange={e => { const f = e.target.files[0]; if (f) onImport(f); e.target.value = '' }} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={importing}
        className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 whitespace-nowrap text-gray-600 disabled:opacity-50">
        {importing ? 'Import...' : '⬆ Importer CSV'}
      </button>
    </>
  )
}

// Result banner shown after a CSV import, with per-row error details.
function ImportResultBanner({ result, onClose }) {
  if (!result) return null
  return (
    <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-blue-800 font-medium">
          Import terminé : {result.success} / {result.total} ligne(s) importée(s).
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>
      {result.errors?.length > 0 && (
        <ul className="mt-2 text-red-600 text-xs list-disc list-inside max-h-32 overflow-y-auto">
          {result.errors.map((er, i) => <li key={i}>Ligne {er.row} : {er.message}</li>)}
        </ul>
      )}
    </div>
  )
}

function Loading() { return <div className="text-center py-10 text-gray-400">Chargement...</div> }
function Empty({ cols, msg = 'Aucun résultat' }) { return <tr><td colSpan={cols} className="text-center py-8 text-gray-400">{msg}</td></tr> }

function Table({ headers, children }) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">{headers}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function AddBtn({ onClick, label }) {
  return (
    <button onClick={onClick} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 whitespace-nowrap">
      {label}
    </button>
  )
}

function ActionBtns({ onEdit, onDelete, onShare }) {
  return (
    <td className="px-4 py-3 text-right whitespace-nowrap">
      <button onClick={onEdit} className="text-blue-500 hover:underline mr-3 text-sm">Modifier</button>
      <button
        onClick={onShare || (() => alert('Partage active'))}
        className="text-orange-500 hover:underline mr-3 text-sm font-medium"
      >
        ⏳ Partager
      </button>
      <button onClick={onDelete} className="text-red-400 hover:underline text-sm">Suppr.</button>
    </td>
  )
}

const TYPE_COLORS = {
  entree: 'bg-green-100 text-green-700', sortie: 'bg-red-100 text-red-700',
  transfert: 'bg-blue-100 text-blue-700', ajustement: 'bg-yellow-100 text-yellow-700',
}

// ─── Stock tab ────────────────────────────────────────────────────────────────

function StockTab() {
  const [stocks, setStocks] = useState([])
  const [resume, setResume] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, r] = await Promise.all([getStocks({ search, page, page_size: 20 }), getStockResume()])
      setStocks(s.results || s); setCount(s.count || 0); setResume(r)
    } finally { setLoading(false) }
  }, [search, page])

  useEffect(() => { load() }, [load])

  const handleReserve = async s => {
    const qty = window.prompt(`Quantité à réserver pour ${s.articleCode} (disponible : ${fmt(s.quantiteDisponibleReelle)} ${s.articleUnite})`, '1')
    if (!qty) return
    setBusyId(s.id); setActionError('')
    try { await reserveStock(s.id, qty); load() }
    catch (e) { setActionError(extractError(e)) }
    finally { setBusyId(null) }
  }

  const handleRelease = async s => {
    const qty = window.prompt(`Quantité à libérer pour ${s.articleCode} (réservé : ${fmt(s.quantite_reservee)} ${s.articleUnite})`, String(s.quantite_reservee))
    if (!qty) return
    setBusyId(s.id); setActionError('')
    try { await releaseStock(s.id, qty); load() }
    catch (e) { setActionError(extractError(e)) }
    finally { setBusyId(null) }
  }

  const lotsASurveiller = resume ? (resume.lots_perimes || 0) + (resume.lots_proches || 0) : 0

  return (
    <div>
      <ErrMsg error={actionError} />
      {resume && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
          {[
            { v: resume.total_articles, l: 'Articles référencés', c: 'text-orange-600' },
            { v: resume.total_alertes,  l: 'Alertes de stock',    c: 'text-red-600' },
            { v: resume.lignes_stock,   l: 'Lignes en stock',     c: 'text-blue-600' },
            { v: `${fmt(resume.valeur_totale)} €`, l: 'Valeur totale du stock', c: 'text-green-600' },
            { v: fmt(resume.total_reserve), l: 'Quantité réservée', c: 'text-purple-600' },
            { v: lotsASurveiller, l: 'Lots à surveiller', c: lotsASurveiller > 0 ? 'text-red-600' : 'text-gray-400' },
          ].map(({ v, l, c }) => (
            <div key={l} className="bg-white rounded-xl border p-4 text-center">
              <div className={`text-2xl font-bold ${c}`}>{v}</div>
              <div className="text-sm text-gray-500 mt-1">{l}</div>
            </div>
          ))}
        </div>
      )}
      {resume && lotsASurveiller > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          ⚠ {resume.lots_perimes > 0 && <>{resume.lots_perimes} lot(s) périmé(s)</>}
          {resume.lots_perimes > 0 && resume.lots_proches > 0 && ' et '}
          {resume.lots_proches > 0 && <>{resume.lots_proches} lot(s) arrivant à péremption sous 30 jours</>}
          {' '}— voir l'onglet Lots.
        </div>
      )}
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher par article ou emplacement..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
      </div>
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Article', 'Lot', 'Entrepôt / Emplacement', 'Quantité', 'Réservé', 'Disponible', 'Valeur', 'Mise à jour', 'Alerte', ''].map((h, i) => (
              <th key={h} className={`px-4 py-3 text-${[3, 4, 5, 6].includes(i) ? 'right' : 'left'} text-xs uppercase text-gray-500`}>{h}</th>
            ))}
          </tr>}>
            {stocks.length === 0 && <Empty cols={10} msg="Aucun stock trouvé" />}
            {stocks.map(s => (
              <tr key={s.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3"><div className="font-medium">{s.articleCode}</div><div className="text-gray-500 text-xs">{s.articleNom}</div></td>
                <td className="px-4 py-3 text-xs">
                  {s.lotNumero || <span className="text-gray-300">&mdash;</span>}
                  {s.lotPeremption && <div className="text-red-500">{s.lotPeremption}</div>}
                </td>
                <td className="px-4 py-3"><div className="text-gray-600">{s.entrepotNom}</div><div className="text-xs text-gray-400">{s.placementCode}</div></td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(s.quantite_disponible)} {s.articleUnite}</td>
                <td className="px-4 py-3 text-right text-gray-500">{fmt(s.quantite_reservee)}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-700">{fmt(s.quantiteDisponibleReelle)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{fmt(s.valeur)} €</td>
                <td className="px-4 py-3 text-xs text-gray-400">{s.derniere_maj ? new Date(s.derniere_maj).toLocaleString('fr-FR') : '—'}</td>
                <td className="px-4 py-3">{s.alerteStock && <Badge color="bg-red-100 text-red-700">Alerte</Badge>}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => handleReserve(s)} disabled={busyId === s.id}
                    className="text-blue-500 hover:underline mr-3 text-xs disabled:opacity-50">Réserver</button>
                  <button onClick={() => handleRelease(s)} disabled={busyId === s.id || !(s.quantite_reservee > 0)}
                    className="text-gray-500 hover:underline text-xs disabled:opacity-50">Libérer</button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Articles tab ─────────────────────────────────────────────────────────────

function ArticleForm({ initial = {}, categories = [], onSubmit, onClose, saving }) {
  const [form, setForm] = useState({
    code_article: initial.code_article || '', nom: initial.nom || '',
    description: initial.description || '', categorie: initial.categorie || '',
    unite_mesure: initial.unite_mesure || 'pcs', prix_unitaire: initial.prix_unitaire || '0',
    duree_vie_jours: initial.duree_vie_jours || '', seuil_alerte: initial.seuil_alerte || '0',
    qr_code: initial.qr_code || '', code_barre: initial.code_barre || '',
    actif: initial.actif !== undefined ? initial.actif : true,
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    const p = { ...form }
    if (!p.duree_vie_jours) p.duree_vie_jours = null
    if (!p.qr_code) p.qr_code = null
    if (!p.code_barre) p.code_barre = null
    if (!p.categorie) p.categorie = null
    onSubmit(p)
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Code article" required><Input value={form.code_article} onChange={e => set('code_article', e.target.value)} required /></Field>
        <Field label="Unité de mesure"><Input value={form.unite_mesure} onChange={e => set('unite_mesure', e.target.value)} /></Field>
      </div>
      <Field label="Nom" required><Input value={form.nom} onChange={e => set('nom', e.target.value)} required /></Field>
      <Field label="Description"><Textarea value={form.description} onChange={e => set('description', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Catégorie">
          <Select value={form.categorie || ''} onChange={e => set('categorie', e.target.value || null)}>
            <option value="">— Sans catégorie —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Select>
        </Field>
        <Field label="Prix unitaire"><Input type="number" step="0.01" min="0" value={form.prix_unitaire} onChange={e => set('prix_unitaire', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Durée de vie (jours)"><Input type="number" min="1" value={form.duree_vie_jours} onChange={e => set('duree_vie_jours', e.target.value)} placeholder="Illimitée" /></Field>
        <Field label="Seuil d'alerte"><Input type="number" min="0" value={form.seuil_alerte} onChange={e => set('seuil_alerte', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="QR code"><Input value={form.qr_code} onChange={e => set('qr_code', e.target.value)} placeholder="Optionnel" /></Field>
        <Field label="Code barre"><Input value={form.code_barre} onChange={e => set('code_barre', e.target.value)} placeholder="Optionnel" /></Field>
      </div>
      <Field label="Statut">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.actif} onChange={e => set('actif', e.target.checked)} className="rounded border-gray-300" />
          Article actif (décocher pour désactiver sans supprimer l'historique)
        </label>
      </Field>
      <FormActions onClose={onClose} saving={saving} />
    </form>
  )
}

function ArticlesTab() {
  const [articles, setArticles] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [actifFilter, setActifFilter] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { search, page, page_size: 20 }
      if (actifFilter) params.actif = actifFilter
      const [a, c] = await Promise.all([getArticles(params), getCategories({ page_size: 200 })])
      setArticles(a.results || a); setCount(a.count || 0); setCategories(c.results || c)
    } finally { setLoading(false) }
  }, [search, page, actifFilter])

  useEffect(() => { load() }, [load])

  const save = async payload => {
    setSaving(true); setError('')
    try {
      modal.mode === 'create' ? await createArticle(payload) : await updateArticle(modal.item.id, payload)
      setModal(null); load()
    } catch (e) { setError(extractError(e)) }
    finally { setSaving(false) }
  }

  const remove = async a => {
    if (!window.confirm(`Supprimer l'article « ${a.nom} » ?`)) return
    setListError('')
    try { await deleteArticle(a.id); load() }
    catch (e) { setListError(extractError(e)) }
  }

  const handleImport = async file => {
    setImporting(true); setListError(''); setImportResult(null)
    try { setImportResult(await importArticlesCsv(file)); load() }
    catch (e) { setListError(extractError(e)) }
    finally { setImporting(false) }
  }

  const exportParams = {}
  if (search) exportParams.search = search
  if (actifFilter) exportParams.actif = actifFilter

  return (
    <div>
      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouvel article' : `Modifier ${modal.item.code_article}`} onClose={() => setModal(null)}>
          <ErrMsg error={error} />
          <ArticleForm initial={modal.item || {}} categories={categories} onSubmit={save} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}
      <ErrMsg error={listError} />
      <ImportResultBanner result={importResult} onClose={() => setImportResult(null)} />
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher par code, nom, code barre..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className={inputCls} style={{ width: '10rem' }} value={actifFilter} onChange={e => { setActifFilter(e.target.value); setPage(1) }}>
          <option value="">Tous statuts</option>
          <option value="oui">Actifs</option>
          <option value="non">Inactifs</option>
        </select>
        <CsvButtons exportUrl={exportArticlesCsvUrl(exportParams)} onImport={handleImport} importing={importing} />
        <AddBtn onClick={() => setModal({ mode: 'create' })} label="+ Nouvel article" />
      </div>
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Code', 'Nom', 'Catégorie', 'Unité', 'Stock total', 'Seuil', 'Alerte', 'Statut', ''].map(h => (
              <th key={h} className={`px-4 py-3 text-${h === 'Stock total' ? 'right' : 'left'} text-xs uppercase text-gray-500`}>{h}</th>
            ))}
          </tr>}>
            {articles.length === 0 && <Empty cols={9} />}
            {articles.map(a => (
              <tr key={a.id} className={`border-t hover:bg-gray-50 ${!a.actif ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-mono text-xs font-medium">{a.code_article}</td>
                <td className="px-4 py-3 font-medium">{a.nom}</td>
                <td className="px-4 py-3 text-gray-500">{a.categorieNom || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{a.unite_mesure}</td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(a.stockTotal)}</td>
                <td className="px-4 py-3 text-gray-500">{a.seuil_alerte}</td>
                <td className="px-4 py-3">{a.alerteStock && <Badge color="bg-red-100 text-red-700">Alerte</Badge>}</td>
                <td className="px-4 py-3">
                  {a.actif
                    ? <Badge color="bg-green-100 text-green-700">Actif</Badge>
                    : <Badge color="bg-gray-100 text-gray-600">Inactif</Badge>}
                </td>
                <ActionBtns onEdit={() => setModal({ mode: 'edit', item: a })} onDelete={() => remove(a)} />
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Mouvements tab ───────────────────────────────────────────────────────────

function MouvementForm({ entrepots, onSubmit, onClose, saving }) {
  const [form, setForm] = useState({
    article: '', lot: '', placement_source: '', placement_destination: '',
    type_mouvement: 'entree', quantite: '', reference_document: '', commentaire: '',
  })
  const [artSearch, setArtSearch] = useState('')
  const [artResults, setArtResults] = useState([])
  const [lotOptions, setLotOptions] = useState([])
  const [plSrc, setPlSrc] = useState([])
  const [plDst, setPlDst] = useState([])
  const [refStock, setRefStock] = useState(null)
  const [showScanner, setShowScanner] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!artSearch) { setArtResults([]); return }
    const t = setTimeout(() => searchArticles(artSearch).then(setArtResults).catch(() => {}), 300)
    return () => clearTimeout(t)
  }, [artSearch])

  const selectArt = async art => {
    set('article', art.id)
    setArtSearch(`${art.code_article} — ${art.nom}`)
    setArtResults([])
    try { const lots = await searchLots('', art.id); setLotOptions(lots); return lots }
    catch { setLotOptions([]); return [] }
  }

  const loadPl = async (entrepotId, side) => {
    try { const pl = await searchPlacements('', entrepotId); side === 'src' ? setPlSrc(pl) : setPlDst(pl) }
    catch {}
  }

  const needsSrc = ['sortie', 'transfert'].includes(form.type_mouvement)
  const needsDst = ['entree', 'transfert', 'ajustement'].includes(form.type_mouvement)
  const isAjustement = form.type_mouvement === 'ajustement'

  // Stock line that limits (sortie/transfert) or is overwritten by (ajustement) this movement.
  const refPlacement = isAjustement ? form.placement_destination : (needsSrc ? form.placement_source : '')

  useEffect(() => {
    if (!form.article || !refPlacement) { setRefStock(null); return }
    let cancelled = false
    getStocks({ article: form.article, placement: refPlacement, page_size: 50 })
      .then(r => {
        if (cancelled) return
        const list = r.results || r
        const match = list.find(s => String(s.lot || '') === String(form.lot || ''))
        setRefStock(match || null)
      })
      .catch(() => { if (!cancelled) setRefStock(null) })
    return () => { cancelled = true }
  }, [form.article, refPlacement, form.lot])

  // A "transfert" can't have the same source and destination — clear destination if it now matches.
  useEffect(() => {
    if (form.type_mouvement === 'transfert' && form.placement_destination
        && form.placement_destination === form.placement_source) {
      set('placement_destination', '')
    }
  }, [form.type_mouvement, form.placement_source])

  const handleScan = async raw => {
    setShowScanner(false)
    const parsed = parseQrContent(raw)
    if (parsed.pn) {
      try {
        const results = await searchArticles(parsed.pn)
        const match = results.find(a => a.code_article === parsed.pn) || results[0]
        if (match) {
          const lots = await selectArt(match)
          if (parsed.lotNum) {
            const lotMatch = lots.find(l => l.numero_lot === parsed.lotNum)
            if (lotMatch) set('lot', lotMatch.id)
          }
        }
      } catch { /* article lookup failed — user fills the form manually */ }
    }
    if (parsed.qty && !isNaN(parseFloat(parsed.qty))) {
      set('quantite', String(parsed.qty))
    }
  }

  const submit = e => {
    e.preventDefault()
    const p = { ...form }
    if (!p.lot) p.lot = null
    if (!p.placement_source) p.placement_source = null
    if (!p.placement_destination) p.placement_destination = null
    onSubmit(p)
  }

  const dispoReelle = refStock ? parseFloat(refStock.quantiteDisponibleReelle) : 0
  const currentQty = refStock ? parseFloat(refStock.quantite_disponible) : 0
  const qtyExceedsDispo = needsSrc && form.quantite !== '' && parseFloat(form.quantite) > dispoReelle
  const missingPlacement = (needsSrc && !form.placement_source) || (needsDst && !form.placement_destination)

  return (
    <form onSubmit={submit}>
      {showScanner && <QrScannerModal onScan={handleScan} onClose={() => setShowScanner(false)} />}
      <div className="flex justify-end mb-2">
        <button type="button" onClick={() => setShowScanner(true)}
          className="px-3 py-1.5 text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-100">
          📷 Scanner un QR code
        </button>
      </div>
      <Field label="Type de mouvement" required>
        <Select value={form.type_mouvement} onChange={e => set('type_mouvement', e.target.value)}>
          <option value="entree">Entrée</option>
          <option value="sortie">Sortie</option>
          <option value="transfert">Transfert</option>
          <option value="ajustement">Ajustement (correction de stock)</option>
        </Select>
      </Field>
      <Field label="Article" required>
        <div className="relative">
          <Input value={artSearch} onChange={e => { setArtSearch(e.target.value); set('article', '') }}
            placeholder="Rechercher un article..." autoComplete="off" />
          {artResults.length > 0 && (
            <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
              {artResults.map(a => (
                <div key={a.id} onClick={() => selectArt(a)} className="px-3 py-2 hover:bg-orange-50 cursor-pointer text-sm">
                  <span className="font-mono font-medium">{a.code_article}</span> — {a.nom}
                </div>
              ))}
            </div>
          )}
        </div>
      </Field>
      {lotOptions.length > 0 && (
        <Field label="Lot">
          <Select value={form.lot} onChange={e => set('lot', e.target.value)}>
            <option value="">— Sans lot —</option>
            {lotOptions.map(l => <option key={l.id} value={l.id}>{l.numero_lot}{l.date_peremption ? ` (exp. ${l.date_peremption})` : ''}</option>)}
          </Select>
        </Field>
      )}
      {needsSrc && (
        <>
          <Field label="Entrepôt source">
            <Select onChange={e => loadPl(e.target.value, 'src')}>
              <option value="">— Choisir —</option>
              {entrepots.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </Select>
          </Field>
          {plSrc.length > 0 && (
            <Field label="Emplacement source">
              <Select value={form.placement_source} onChange={e => set('placement_source', e.target.value)}>
                <option value="">— Choisir —</option>
                {plSrc.map(p => <option key={p.id} value={p.id}>{p.entrepotCode}/{p.code_emplacement}</option>)}
              </Select>
            </Field>
          )}
          {form.article && form.placement_source && (
            <div className={`text-xs mb-3 -mt-2 ${qtyExceedsDispo ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              Disponible à cet emplacement : {fmt(dispoReelle)}{refStock ? ` ${refStock.articleUnite}` : ''}
              {refStock && parseFloat(refStock.quantite_reservee) > 0 && ` (dont ${fmt(refStock.quantite_reservee)} réservé)`}
              {qtyExceedsDispo && ' — quantité demandée supérieure au disponible !'}
            </div>
          )}
        </>
      )}
      {needsDst && (
        <>
          <Field label={isAjustement ? 'Entrepôt à ajuster' : 'Entrepôt destination'}>
            <Select onChange={e => loadPl(e.target.value, 'dst')}>
              <option value="">— Choisir —</option>
              {entrepots.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </Select>
          </Field>
          {plDst.length > 0 && (
            <Field label={isAjustement ? 'Emplacement à ajuster' : 'Emplacement destination'}>
              <Select value={form.placement_destination} onChange={e => set('placement_destination', e.target.value)}>
                <option value="">— Choisir —</option>
                {plDst
                  .filter(p => form.type_mouvement !== 'transfert' || String(p.id) !== String(form.placement_source))
                  .map(p => <option key={p.id} value={p.id}>{p.entrepotCode}/{p.code_emplacement}</option>)}
              </Select>
            </Field>
          )}
          {isAjustement && form.article && form.placement_destination && (
            <div className="text-xs mb-3 -mt-2 text-gray-500">
              Quantité actuelle à cet emplacement : {fmt(currentQty)}{refStock ? ` ${refStock.articleUnite}` : ''}
            </div>
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-x-4">
        <Field label={isAjustement ? 'Nouvelle quantité (valeur absolue)' : 'Quantité'} required>
          <Input type="number" step="0.01" min={isAjustement ? '0' : '0.01'} value={form.quantite} onChange={e => set('quantite', e.target.value)} required />
        </Field>
        <Field label="Référence document">
          <Input value={form.reference_document} onChange={e => set('reference_document', e.target.value)} placeholder="BL, BC, OF..." />
        </Field>
      </div>
      {isAjustement && (
        <div className="text-xs text-gray-500 -mt-3 mb-3">
          Pour un ajustement, la quantité saisie remplace le stock disponible à cet emplacement (ce n'est pas un ajout/retrait).
        </div>
      )}
      <Field label="Commentaire"><Textarea value={form.commentaire} onChange={e => set('commentaire', e.target.value)} /></Field>
      <div className="flex justify-end gap-3 mt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Annuler</button>
        <button type="submit" disabled={saving || !form.article || !form.quantite || missingPlacement}
          className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
          {saving ? 'Enregistrement...' : 'Créer le mouvement'}
        </button>
      </div>
    </form>
  )
}

function MouvementsTab() {
  const [mouvements, setMouvements] = useState([])
  const [entrepots, setEntrepots] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [reversing, setReversing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { search, page, page_size: 20 }
      if (typeFilter) params.type_mouvement = typeFilter
      const [m, e] = await Promise.all([getMouvements(params), getEntrepots({ page_size: 200 })])
      setMouvements(m.results || m); setCount(m.count || 0); setEntrepots(e.results || e)
    } finally { setLoading(false) }
  }, [search, page, typeFilter])

  useEffect(() => { load() }, [load])

  const save = async payload => {
    setSaving(true); setError('')
    try { await createMouvement(payload); setShowForm(false); load() }
    catch (e) { setError(extractError(e)) }
    finally { setSaving(false) }
  }

  const handleReverse = async m => {
    if (!window.confirm(`Annuler le mouvement #${m.id} (${m.typeMouvementDisplay} — ${fmt(m.quantite)} ${m.articleCode}) ?`)) return
    setReversing(m.id); setListError('')
    try { await reverseMouvement(m.id); load() }
    catch (e) { setListError(extractError(e)) }
    finally { setReversing(null) }
  }

  return (
    <div>
      {showForm && (
        <Modal title="Nouveau mouvement" onClose={() => setShowForm(false)}>
          <ErrMsg error={error} />
          <MouvementForm entrepots={entrepots} onSubmit={save} onClose={() => setShowForm(false)} saving={saving} />
        </Modal>
      )}
      <ErrMsg error={listError} />
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher par article, référence..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className={inputCls} style={{ width: '10rem' }} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}>
          <option value="">Tous types</option>
          <option value="entree">Entrée</option>
          <option value="sortie">Sortie</option>
          <option value="transfert">Transfert</option>
          <option value="ajustement">Ajustement</option>
        </select>
        <AddBtn onClick={() => setShowForm(true)} label="+ Nouveau mouvement" />
      </div>
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Date', 'Type', 'Article', 'Quantité', 'Lot', 'Trajet', 'Référence', 'Utilisateur', ''].map(h => (
              <th key={h} className={`px-4 py-3 text-${h === 'Quantité' ? 'right' : 'left'} text-xs uppercase text-gray-500`}>{h}</th>
            ))}
          </tr>}>
            {mouvements.length === 0 && <Empty cols={9} msg="Aucun mouvement trouvé" />}
            {mouvements.map(m => (
              <tr key={m.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(m.date_mouvement).toLocaleString('fr-FR')}</td>
                <td className="px-4 py-3"><Badge color={TYPE_COLORS[m.type_mouvement] || 'bg-gray-100 text-gray-600'}>{m.typeMouvementDisplay}</Badge></td>
                <td className="px-4 py-3"><div className="font-mono text-xs font-medium">{m.articleCode}</div><div className="text-gray-500 text-xs">{m.articleNom}</div></td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(m.quantite)}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{m.lotNumero || '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {m.placementSourceCode || ''}{m.placementSourceCode && m.placementDestCode ? ' → ' : ''}{m.placementDestCode || ''}
                  {!m.placementSourceCode && !m.placementDestCode && '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{m.reference_document || '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{m.utilisateurNom || '—'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {m.type_mouvement !== 'ajustement' && (
                    <button onClick={() => handleReverse(m)} disabled={reversing === m.id}
                      className="text-red-500 hover:underline text-xs disabled:opacity-50">
                      {reversing === m.id ? '...' : 'Annuler'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Lots tab ─────────────────────────────────────────────────────────────────

function LotForm({ initial = {}, articles = [], onSubmit, onClose, saving }) {
  const [form, setForm] = useState({
    article: initial.article || '', numero_lot: initial.numero_lot || '',
    date_fabrication: initial.date_fabrication || '', date_peremption: initial.date_peremption || '',
    quantite_initiale: initial.quantite_initiale || '0', statut: initial.statut || 'actif',
    qr_code: initial.qr_code || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    const p = { ...form }
    if (!p.date_fabrication) p.date_fabrication = null
    if (!p.date_peremption) p.date_peremption = null
    if (!p.qr_code) p.qr_code = null
    onSubmit(p)
  }

  return (
    <form onSubmit={submit}>
      <Field label="Article" required>
        <Select value={form.article} onChange={e => set('article', e.target.value)} required>
          <option value="">— Choisir un article —</option>
          {articles.map(a => <option key={a.id} value={a.id}>{a.code_article} — {a.nom}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Numéro de lot" required><Input value={form.numero_lot} onChange={e => set('numero_lot', e.target.value)} required /></Field>
        <Field label="Statut">
          <Select value={form.statut} onChange={e => set('statut', e.target.value)}>
            <option value="actif">Actif</option><option value="perime">Périmé</option><option value="epuise">Épuisé</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Date de fabrication"><Input type="date" value={form.date_fabrication} onChange={e => set('date_fabrication', e.target.value)} /></Field>
        <Field label="Date de péremption"><Input type="date" value={form.date_peremption} onChange={e => set('date_peremption', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Quantité initiale"><Input type="number" step="0.01" min="0" value={form.quantite_initiale} onChange={e => set('quantite_initiale', e.target.value)} /></Field>
        <Field label="QR code"><Input value={form.qr_code} onChange={e => set('qr_code', e.target.value)} placeholder="Optionnel" /></Field>
      </div>
      <FormActions onClose={onClose} saving={saving} />
    </form>
  )
}

function LotsTab() {
  const [lots, setLots] = useState([])
  const [articles, setArticles] = useState([])
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { search, page, page_size: 20 }
      if (statutFilter) params.statut = statutFilter
      const [l, a] = await Promise.all([getLots(params), getArticles({ page_size: 200 })])
      setLots(l.results || l); setCount(l.count || 0); setArticles(a.results || a)
    } finally { setLoading(false) }
  }, [search, page, statutFilter])

  useEffect(() => { load() }, [load])

  const save = async payload => {
    setSaving(true); setError('')
    try {
      modal.mode === 'create' ? await createLot(payload) : await updateLot(modal.item.id, payload)
      setModal(null); load()
    } catch (e) { setError(extractError(e)) }
    finally { setSaving(false) }
  }

  const remove = async l => {
    if (!window.confirm(`Supprimer le lot « ${l.numero_lot} » ?`)) return
    setListError('')
    try { await deleteLot(l.id); load() }
    catch (e) { setListError(extractError(e)) }
  }

  const handleImport = async file => {
    setImporting(true); setListError(''); setImportResult(null)
    try { setImportResult(await importLotsCsv(file)); load() }
    catch (e) { setListError(extractError(e)) }
    finally { setImporting(false) }
  }

  const exportParams = {}
  if (search) exportParams.search = search
  if (statutFilter) exportParams.statut = statutFilter

  return (
    <div>
      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouveau lot' : `Modifier lot ${modal.item.numero_lot}`} onClose={() => setModal(null)}>
          <ErrMsg error={error} />
          <LotForm initial={modal.item || {}} articles={articles} onSubmit={save} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}
      <ErrMsg error={listError} />
      <ImportResultBanner result={importResult} onClose={() => setImportResult(null)} />
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher par numéro, article..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className={inputCls} style={{ width: '10rem' }} value={statutFilter} onChange={e => { setStatutFilter(e.target.value); setPage(1) }}>
          <option value="">Tous statuts</option>
          <option value="actif">Actif</option><option value="perime">Périmé</option><option value="epuise">Épuisé</option>
        </select>
        <CsvButtons exportUrl={exportLotsCsvUrl(exportParams)} onImport={handleImport} importing={importing} />
        <AddBtn onClick={() => setModal({ mode: 'create' })} label="+ Nouveau lot" />
      </div>
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Article', 'N° lot', 'Fabrication', 'Péremption', 'Qté initiale', 'Statut', ''].map(h => (
              <th key={h} className={`px-4 py-3 text-${h === 'Qté initiale' ? 'right' : 'left'} text-xs uppercase text-gray-500`}>{h}</th>
            ))}
          </tr>}>
            {lots.length === 0 && <Empty cols={7} />}
            {lots.map(l => (
              <tr key={l.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3"><div className="font-mono text-xs font-medium">{l.articleCode}</div><div className="text-gray-500 text-xs">{l.articleNom}</div></td>
                <td className="px-4 py-3 font-medium">{l.numero_lot}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{l.date_fabrication || '—'}</td>
                <td className="px-4 py-3 text-xs">
                  {l.date_peremption
                    ? <span className={l.estPerime ? 'text-red-600 font-medium' : 'text-gray-600'}>{l.date_peremption}{l.estPerime ? ' ⚠' : ''}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right">{fmt(l.quantite_initiale)}</td>
                <td className="px-4 py-3"><StatutBadge statut={l.statut} /></td>
                <ActionBtns onEdit={() => setModal({ mode: 'edit', item: l })} onDelete={() => remove(l)} />
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Entrepôts tab ────────────────────────────────────────────────────────────

function EntrepotForm({ initial = {}, onSubmit, onClose, saving }) {
  const [form, setForm] = useState({
    code_entrepot: initial.code_entrepot || '', nom: initial.nom || '',
    adresse: initial.adresse || '', ville: initial.ville || '',
    responsable: initial.responsable || '', capacite_max: initial.capacite_max || '',
    statut: initial.statut || 'actif',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    const p = { ...form }
    if (!p.capacite_max) p.capacite_max = null
    onSubmit(p)
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Code entrepôt" required><Input value={form.code_entrepot} onChange={e => set('code_entrepot', e.target.value)} required /></Field>
        <Field label="Statut">
          <Select value={form.statut} onChange={e => set('statut', e.target.value)}>
            <option value="actif">Actif</option><option value="inactif">Inactif</option><option value="maintenance">Maintenance</option>
          </Select>
        </Field>
      </div>
      <Field label="Nom" required><Input value={form.nom} onChange={e => set('nom', e.target.value)} required /></Field>
      <Field label="Adresse"><Textarea value={form.adresse} onChange={e => set('adresse', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Ville"><Input value={form.ville} onChange={e => set('ville', e.target.value)} /></Field>
        <Field label="Responsable"><Input value={form.responsable} onChange={e => set('responsable', e.target.value)} /></Field>
      </div>
      <Field label="Capacité maximale"><Input type="number" min="1" value={form.capacite_max} onChange={e => set('capacite_max', e.target.value)} placeholder="Illimitée" /></Field>
      <FormActions onClose={onClose} saving={saving} />
    </form>
  )
}

function EntrepotsTab() {
  const [entrepots, setEntrepots] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const e = await getEntrepots({ search, page, page_size: 20 })
      setEntrepots(e.results || e); setCount(e.count || 0)
    } finally { setLoading(false) }
  }, [search, page])

  useEffect(() => { load() }, [load])

  const save = async payload => {
    setSaving(true); setError('')
    try {
      modal.mode === 'create' ? await createEntrepot(payload) : await updateEntrepot(modal.item.id, payload)
      setModal(null); load()
    } catch (e) { setError(extractError(e)) }
    finally { setSaving(false) }
  }

  const remove = async e => {
    if (!window.confirm(`Supprimer l'entrepôt « ${e.nom} » ?`)) return
    setListError('')
    try { await deleteEntrepot(e.id); load() }
    catch (err) { setListError(extractError(err)) }
  }

  const handleImport = async file => {
    setImporting(true); setListError(''); setImportResult(null)
    try { setImportResult(await importEntrepotsCsv(file)); load() }
    catch (e) { setListError(extractError(e)) }
    finally { setImporting(false) }
  }

  return (
    <div>
      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouvel entrepôt' : `Modifier ${modal.item.nom}`} onClose={() => setModal(null)}>
          <ErrMsg error={error} />
          <EntrepotForm initial={modal.item || {}} onSubmit={save} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}
      <ErrMsg error={listError} />
      <ImportResultBanner result={importResult} onClose={() => setImportResult(null)} />
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <CsvButtons exportUrl={exportEntrepotsCsvUrl(search ? { search } : {})} onImport={handleImport} importing={importing} />
        <AddBtn onClick={() => setModal({ mode: 'create' })} label="+ Nouvel entrepôt" />
      </div>
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Code', 'Nom', 'Ville', 'Responsable', 'Capacité', 'Emplacements', 'Statut', ''].map(h => (
              <th key={h} className={`px-4 py-3 text-${['Capacité', 'Emplacements'].includes(h) ? 'right' : 'left'} text-xs uppercase text-gray-500`}>{h}</th>
            ))}
          </tr>}>
            {entrepots.length === 0 && <Empty cols={8} />}
            {entrepots.map(e => (
              <tr key={e.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs font-medium">{e.code_entrepot}</td>
                <td className="px-4 py-3 font-medium">{e.nom}</td>
                <td className="px-4 py-3 text-gray-500">{e.ville || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{e.responsable || '—'}</td>
                <td className="px-4 py-3 text-right text-gray-500">{e.capacite_max || '∞'}</td>
                <td className="px-4 py-3 text-right text-gray-600">{e.nbPlacements}</td>
                <td className="px-4 py-3"><StatutBadge statut={e.statut} /></td>
                <ActionBtns onEdit={() => setModal({ mode: 'edit', item: e })} onDelete={() => remove(e)} />
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Placements tab ───────────────────────────────────────────────────────────

function PlacementForm({ initial = {}, entrepots = [], onSubmit, onClose, saving }) {
  const [form, setForm] = useState({
    entrepot: initial.entrepot || '', code_emplacement: initial.code_emplacement || '',
    zone: initial.zone || '', allee: initial.allee || '', niveau: initial.niveau || '',
    capacite_max: initial.capacite_max || '', statut: initial.statut || 'disponible',
    qr_code: initial.qr_code || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    const p = { ...form }
    if (!p.capacite_max) p.capacite_max = null
    if (!p.qr_code) p.qr_code = null
    onSubmit(p)
  }

  return (
    <form onSubmit={submit}>
      <Field label="Entrepôt" required>
        <Select value={form.entrepot} onChange={e => set('entrepot', e.target.value)} required>
          <option value="">— Choisir un entrepôt —</option>
          {entrepots.map(e => <option key={e.id} value={e.id}>{e.code_entrepot} — {e.nom}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Code emplacement" required><Input value={form.code_emplacement} onChange={e => set('code_emplacement', e.target.value)} required /></Field>
        <Field label="Statut">
          <Select value={form.statut} onChange={e => set('statut', e.target.value)}>
            <option value="disponible">Disponible</option><option value="plein">Plein</option><option value="bloque">Bloqué</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-x-4">
        <Field label="Zone"><Input value={form.zone} onChange={e => set('zone', e.target.value)} placeholder="A, B..." /></Field>
        <Field label="Allée"><Input value={form.allee} onChange={e => set('allee', e.target.value)} placeholder="01..." /></Field>
        <Field label="Niveau"><Input value={form.niveau} onChange={e => set('niveau', e.target.value)} placeholder="01..." /></Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Capacité max"><Input type="number" min="1" value={form.capacite_max} onChange={e => set('capacite_max', e.target.value)} placeholder="Illimitée" /></Field>
        <Field label="QR code"><Input value={form.qr_code} onChange={e => set('qr_code', e.target.value)} placeholder="Optionnel" /></Field>
      </div>
      <FormActions onClose={onClose} saving={saving} />
    </form>
  )
}

function PlacementsTab() {
  const [placements, setPlacements] = useState([])
  const [entrepots, setEntrepots] = useState([])
  const [search, setSearch] = useState('')
  const [entrepotFilter, setEntrepotFilter] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { search, page, page_size: 20 }
      if (entrepotFilter) params.entrepot = entrepotFilter
      const [pl, en] = await Promise.all([getPlacements(params), getEntrepots({ page_size: 200 })])
      setPlacements(pl.results || pl); setCount(pl.count || 0); setEntrepots(en.results || en)
    } finally { setLoading(false) }
  }, [search, page, entrepotFilter])

  useEffect(() => { load() }, [load])

  const save = async payload => {
    setSaving(true); setError('')
    try {
      modal.mode === 'create' ? await createPlacement(payload) : await updatePlacement(modal.item.id, payload)
      setModal(null); load()
    } catch (e) { setError(extractError(e)) }
    finally { setSaving(false) }
  }

  const remove = async p => {
    if (!window.confirm(`Supprimer l'emplacement « ${p.code_emplacement} » ?`)) return
    setListError('')
    try { await deletePlacement(p.id); load() }
    catch (e) { setListError(extractError(e)) }
  }

  const handleImport = async file => {
    setImporting(true); setListError(''); setImportResult(null)
    try { setImportResult(await importPlacementsCsv(file)); load() }
    catch (e) { setListError(extractError(e)) }
    finally { setImporting(false) }
  }

  const exportParams = {}
  if (search) exportParams.search = search
  if (entrepotFilter) exportParams.entrepot = entrepotFilter

  return (
    <div>
      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouvel emplacement' : `Modifier ${modal.item.code_emplacement}`} onClose={() => setModal(null)}>
          <ErrMsg error={error} />
          <PlacementForm initial={modal.item || {}} entrepots={entrepots} onSubmit={save} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}
      <ErrMsg error={listError} />
      <ImportResultBanner result={importResult} onClose={() => setImportResult(null)} />
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher par code, zone..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className={inputCls} style={{ width: '12rem' }} value={entrepotFilter} onChange={e => { setEntrepotFilter(e.target.value); setPage(1) }}>
          <option value="">Tous les entrepôts</option>
          {entrepots.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
        <CsvButtons exportUrl={exportPlacementsCsvUrl(exportParams)} onImport={handleImport} importing={importing} />
        <AddBtn onClick={() => setModal({ mode: 'create' })} label="+ Nouvel emplacement" />
      </div>
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Entrepôt', 'Code', 'Zone', 'Allée', 'Niveau', 'Capacité', 'Statut', ''].map(h => (
              <th key={h} className={`px-4 py-3 text-${h === 'Capacité' ? 'right' : 'left'} text-xs uppercase text-gray-500`}>{h}</th>
            ))}
          </tr>}>
            {placements.length === 0 && <Empty cols={8} />}
            {placements.map(p => (
              <tr key={p.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3"><div className="font-mono text-xs font-medium">{p.entrepotCode}</div><div className="text-xs text-gray-400">{p.entrepotNom}</div></td>
                <td className="px-4 py-3 font-medium">{p.code_emplacement}</td>
                <td className="px-4 py-3 text-gray-500">{p.zone || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{p.allee || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{p.niveau || '—'}</td>
                <td className="px-4 py-3 text-right text-gray-500">{p.capacite_max || '∞'}</td>
                <td className="px-4 py-3"><StatutBadge statut={p.statut} /></td>
                <ActionBtns onEdit={() => setModal({ mode: 'edit', item: p })} onDelete={() => remove(p)} />
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Catégories tab ───────────────────────────────────────────────────────────

function CategorieForm({ initial = {}, allCategories = [], onSubmit, onClose, saving }) {
  const [form, setForm] = useState({
    code_categorie: initial.code_categorie || '', nom: initial.nom || '',
    description: initial.description || '', parent: initial.parent || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    const p = { ...form }
    if (!p.parent) p.parent = null
    onSubmit(p)
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Code catégorie" required><Input value={form.code_categorie} onChange={e => set('code_categorie', e.target.value)} required /></Field>
        <Field label="Catégorie parente">
          <Select value={form.parent || ''} onChange={e => set('parent', e.target.value || null)}>
            <option value="">— Racine —</option>
            {allCategories.filter(c => c.id !== initial.id).map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Nom" required><Input value={form.nom} onChange={e => set('nom', e.target.value)} required /></Field>
      <Field label="Description"><Textarea value={form.description} onChange={e => set('description', e.target.value)} /></Field>
      <FormActions onClose={onClose} saving={saving} />
    </form>
  )
}

function CategoriesTab() {
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const c = await getCategories({ search, page, page_size: 20 })
      setCategories(c.results || c); setCount(c.count || 0)
    } finally { setLoading(false) }
  }, [search, page])

  useEffect(() => { load() }, [load])

  const save = async payload => {
    setSaving(true); setError('')
    try {
      modal.mode === 'create' ? await createCategorie(payload) : await updateCategorie(modal.item.id, payload)
      setModal(null); load()
    } catch (e) { setError(extractError(e)) }
    finally { setSaving(false) }
  }

  const remove = async c => {
    if (!window.confirm(`Supprimer la catégorie « ${c.nom} » ?`)) return
    setListError('')
    try { await deleteCategorie(c.id); load() }
    catch (e) { setListError(extractError(e)) }
  }

  return (
    <div>
      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nouvelle catégorie' : `Modifier ${modal.item.nom}`} onClose={() => setModal(null)}>
          <ErrMsg error={error} />
          <CategorieForm initial={modal.item || {}} allCategories={categories} onSubmit={save} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}
      <ErrMsg error={listError} />
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <AddBtn onClick={() => setModal({ mode: 'create' })} label="+ Nouvelle catégorie" />
      </div>
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Code', 'Nom', 'Parente', 'Articles', ''].map(h => (
              <th key={h} className={`px-4 py-3 text-${h === 'Articles' ? 'right' : 'left'} text-xs uppercase text-gray-500`}>{h}</th>
            ))}
          </tr>}>
            {categories.length === 0 && <Empty cols={5} />}
            {categories.map(c => (
              <tr key={c.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs font-medium">{c.code_categorie}</td>
                <td className="px-4 py-3 font-medium">{c.nom}</td>
                <td className="px-4 py-3 text-gray-500">{c.parentNom || '—'}</td>
                <td className="px-4 py-3 text-right text-gray-600">{c.nbArticles}</td>
                <ActionBtns onEdit={() => setModal({ mode: 'edit', item: c })} onDelete={() => remove(c)} />
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Tickets tab ──────────────────────────────────────────────────────────────

function TicketsTab() {
  const [tickets, setTickets] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)

  // Scanner state
  const [showScanner, setShowScanner] = useState(false)
  const [scanned, setScanned] = useState(null)   // { raw, parsed }
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Print state
  const [printTicket, setPrintTicket] = useState(null)  // ticket object

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { search, page, page_size: 20 }
      if (typeFilter) params.type_source = typeFilter
      const t = await getTickets(params)
      setTickets(t.results || t); setCount(t.count || 0)
    } finally { setLoading(false) }
  }, [search, page, typeFilter])

  useEffect(() => { load() }, [load])

  // Called when QR scanner reads a code
  const handleScan = (raw) => {
    setShowScanner(false)
    const parsed = parseQrContent(raw)
    setScanned({ raw, parsed })
    setSaveError('')
  }

  // Save scanned QR as a ticket
  const handleSaveTicket = async () => {
    if (!scanned) return
    setSaving(true); setSaveError('')
    try {
      const payload = {
        qr_contenu: scanned.raw,
        type_source: 'article',
        statut: 'genere',
        code_barre_genere: (scanned.parsed.pn || scanned.raw || '').slice(0, 200),
      }
      const ticket = await createTicket(payload)
      setScanned(null)
      load()
      // Open print immediately after save
      setPrintTicket({ ...ticket, _parsed: scanned.parsed })
    } catch (e) {
      setSaveError(extractError(e))
    } finally { setSaving(false) }
  }

  return (
    <div>
      {/* Scanner modal */}
      {showScanner && (
        <QrScannerModal
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Print modal */}
      {printTicket && (
        <TicketPrintModal
          ticket={printTicket}
          parsed={printTicket._parsed || parseQrContent(printTicket.qr_contenu)}
          onClose={() => setPrintTicket(null)}
        />
      )}

      {/* Scanned result — confirm + preview before saving */}
      {scanned && (
        <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-orange-800">QR code scanné — confirmer l'enregistrement</h3>
            <button onClick={() => setScanned(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm mb-4">
            {[
              ['Référence (PN)', scanned.parsed.pn],
              ['Description',   scanned.parsed.desc],
              ['Quantité',      scanned.parsed.qty],
              ['Emplacement',   scanned.parsed.loc],
              ['N° lot',        scanned.parsed.lotNum],
              ['Ordre',         scanned.parsed.orderNum],
              ['Client',        scanned.parsed.customer],
              ['Date',          scanned.parsed.date],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} className="bg-white rounded-lg px-3 py-2 border">
                <div className="text-xs text-gray-400 uppercase">{label}</div>
                <div className="font-medium text-gray-800 text-xs mt-0.5 break-all">{value}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-500 mb-3 font-mono bg-white border rounded p-2 truncate">
            {scanned.raw}
          </div>
          {saveError && <div className="text-red-600 text-sm mb-2">{saveError}</div>}
          <div className="flex gap-3">
            <button onClick={() => setScanned(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
              Annuler
            </button>
            <button onClick={handleSaveTicket} disabled={saving}
              className="px-5 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
              {saving ? 'Enregistrement...' : '✓ Enregistrer & imprimer'}
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex gap-3 mb-4">
        <input className={`${inputCls} flex-1`} placeholder="Rechercher par contenu QR, article..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className={inputCls} style={{ width: '10rem' }} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}>
          <option value="">Tous types</option>
          <option value="article">Article</option>
          <option value="lot">Lot</option>
          <option value="placement">Emplacement</option>
        </select>
        <button onClick={() => setShowScanner(true)}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 whitespace-nowrap flex items-center gap-2">
          📷 Scanner QR
        </button>
      </div>

      {/* Tickets table */}
      {loading ? <Loading /> : (
        <>
          <Table headers={<tr>
            {['Date scan', 'Type', 'Article', 'Lot / Empl.', 'Contenu QR', 'Statut', 'Utilisateur', ''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs uppercase text-gray-500">{h}</th>
            ))}
          </tr>}>
            {tickets.length === 0 && <Empty cols={8} msg="Aucun ticket trouvé" />}
            {tickets.map(t => (
              <tr key={t.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(t.date_scan).toLocaleString('fr-FR')}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{t.typeDisplay}</td>
                <td className="px-4 py-3 font-mono text-xs">{t.articleCode || '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{t.lotNumero || t.placementCode || '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-400 max-w-xs truncate">{t.qr_contenu}</td>
                <td className="px-4 py-3"><StatutBadge statut={t.statut} /></td>
                <td className="px-4 py-3 text-xs text-gray-500">{t.utilisateurNom || '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setPrintTicket({ ...t, _parsed: parseQrContent(t.qr_contenu) })}
                    className="text-xs text-orange-500 hover:underline whitespace-nowrap">
                    🖨 Imprimer
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} count={count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ─── Main StoragePage ─────────────────────────────────────────────────────────
// Tab state is managed by the parent (App.jsx) and passed in via props.
// The tab bar itself is rendered by the parent as StorageTabBar.

export default function StoragePage({ tab = 'stock', currentUser }) {
  const [cocherTous, setCocherTous] = useState(false)
  const [duration, setDuration] = useState(10)
  const [isInfinite, setIsInfinite] = useState(false)

  return (
    <div className="min-h-full bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'stock'      && <StockTab />}
        {tab === 'articles'   && <ArticlesTab />}
        {tab === 'mouvements' && <MouvementsTab />}
        {tab === 'lots'       && <LotsTab />}
        {tab === 'entrepots'  && <EntrepotsTab />}
        {tab === 'placements' && <PlacementsTab />}
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'tickets'       && <TicketsTab />}
        {tab === 'bom-materiaux' && <BomMaterialsPage />}

        {/* Partage dynamic — Timer d'accès Admin */}
        <div className="p-4 border rounded-xl bg-gray-50 border-gray-200 my-4 shadow-sm">
          <h6 className="text-sm font-semibold text-gray-800 mb-2">⚙️ Partage dynamic (Timer d l-Admin)</h6>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              id="cocherTous"
              checked={cocherTous}
              onChange={(e) => setCocherTous(e.target.checked)}
            />
            <label className="text-sm text-gray-700 cursor-pointer" htmlFor="cocherTous">
              Sélectionner tous les employés (Cocher Tout)
            </label>
          </div>

          <div className="mb-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">⏱️ Ekhtar l-wa9t d l-access:</label>
            <select
              className="w-full border rounded-lg px-3 py-1.5 text-sm"
              value={isInfinite ? 'infinite' : duration}
              onChange={(e) => {
                if (e.target.value === 'infinite') {
                  setIsInfinite(true)
                  setDuration(null)
                } else {
                  setIsInfinite(false)
                  setDuration(parseInt(e.target.value, 10))
                }
              }}
            >
              <option value="10">10 Dqayq (Défaut)</option>
              <option value="30">30 Dqayq</option>
              <option value="60">1 Sa3a (60 min)</option>
              <option value="infinite">Illimité (À vie)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
