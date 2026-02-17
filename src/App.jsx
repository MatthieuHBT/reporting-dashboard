import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  BarChart3,
  Trophy,
  Package,
  TrendingUp,
  RefreshCw,
  Sun,
  Moon,
  Download,
  Calendar,
  Filter,
  LogOut,
  X,
  Menu,
  Settings as SettingsIcon,
  KeyRound,
  ChevronUp,
  ChevronDown,
  Sparkles,
} from 'lucide-react'
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { exportToCsv } from './utils/exportCsv'
import { format, subDays, startOfDay, differenceInDays } from 'date-fns'
import { api, getStoredToken, setStoredToken } from './api/client'
import { parseAdName } from './utils/parseAdNaming'
import Login from './pages/Login'
import Admin from './pages/Admin'
import Settings from './pages/Settings'
import { PAGE_IDS, PAGE_LABELS } from './data/members'
import './App.css'

const SIDEBAR_SECTIONS = [
  {
    title: 'General',
    items: [
      { id: 'general', label: 'General', icon: Sparkles },
    ],
  },
  {
    title: 'Reporting Ads Manager',
    items: [
      { id: 'spend', label: 'Spend', icon: BarChart3 },
    ],
  },
  {
    title: 'Reportings Advertising',
    items: [
      { id: 'stock', label: 'Stock', icon: Package },
      { id: 'winners', label: 'Winners', icon: Trophy },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'admin', label: 'Members', icon: SettingsIcon },
      { id: 'settings', label: 'Settings', icon: KeyRound },
    ],
  },
]

const DATE_RANGES = [
  { id: 'full', label: 'Full', days: 0, preset: 'full' },
  { id: '30d', label: 'Last 30 days', days: 30, preset: 'last_30d' },
  { id: 'custom', label: 'Custom', days: 0, preset: null },
]

function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [connected, setConnected] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [dbMode, setDbMode] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('spend') // spend | finance | stock | winners | general
  const [theme, setTheme] = useState('dark')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [dateRange, setDateRange] = useState('full')
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [filterProduct, setFilterProduct] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [filterAccount, setFilterAccount] = useState('')
  const [winnersSortBy, setWinnersSortBy] = useState('spend')
  const [winnersSortDir, setWinnersSortDir] = useState('desc') // desc = meilleur en premier
  const [winnersMinSpend, setWinnersMinSpend] = useState(100)
  const [stockFilterWarehouse, setStockFilterWarehouse] = useState('')
  const [spendData, setSpendData] = useState(null)
  const [winnersData, setWinnersData] = useState(null)
  const [apiError, setApiError] = useState(null)
  const [selectedWinner, setSelectedWinner] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const hasSetInitialTab = useRef(false)


  const canAccess = (pageId) => {
    if (!currentUser) return true
    if (currentUser.role === 'admin') return true
    return (currentUser.pages || []).includes(pageId)
  }

  const isAdmin = currentUser?.role === 'admin'

  const visibleSidebarItems = useMemo(() => {
    return SIDEBAR_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.id === 'admin') return isAdmin
        if (item.id === 'settings') return isAdmin && dbMode
        if (item.id === 'general') return canAccess('general')
        return canAccess(item.id)
      }),
    })).filter((s) => s.items.length > 0)
  }, [currentUser, isAdmin, dbMode])

  const firstAccessiblePage = useMemo(() => {
    for (const section of visibleSidebarItems) {
      const item = section.items.find((i) => i.id !== 'general')
      if (item) return item.id
    }
    return 'spend'
  }, [visibleSidebarItems])

  useEffect(() => {
    if (currentUser && activeTab && !canAccess(activeTab) && activeTab !== 'general') {
      setActiveTab(firstAccessiblePage)
    }
  }, [currentUser, activeTab, firstAccessiblePage])

  useEffect(() => {
    if (connected && dbMode && canAccess('general') && !hasSetInitialTab.current) {
      setActiveTab('general')
      hasSetInitialTab.current = true
    }
  }, [connected, dbMode, currentUser])

  useEffect(() => {
    const token = getStoredToken()
    if (token) {
      api.auth.db.me()
        .then((data) => {
          setConnected(true)
          setDbMode(true)
          if (data.user) setCurrentUser(data.user)
          setDemoMode(false)
        })
        .catch(() => {
          setStoredToken(null)
          setConnected(false)
        })
        .finally(() => setAuthChecked(true))
    } else {
      api.auth.status()
        .then((r) => setConnected(!!r.connected))
        .catch(() => setConnected(false))
        .finally(() => setAuthChecked(true))
    }
  }, [])

  const fetchSpend = useCallback(async () => {
    setIsLoading(true)
    setApiError(null)
    try {
      const range = DATE_RANGES.find((r) => r.id === dateRange)
      const params = range?.preset
        ? { datePreset: range.preset }
        : { since: dateFrom, until: dateTo }
      if (filterAccount) params.account = filterAccount
      const data = await api.reports.spend(params)
      setSpendData(data)
    } catch (err) {
      setApiError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [dateRange, dateFrom, dateTo, filterAccount])

  const fetchWinners = useCallback(async () => {
    try {
      const range = DATE_RANGES.find((r) => r.id === dateRange)
      const params = range?.preset ? { datePreset: range.preset } : { since: dateFrom, until: dateTo }
      if (filterAccount) params.account = filterAccount
      const data = await api.reports.winners(params)
      setWinnersData(data)
    } catch (err) {
      console.warn('Winners fetch failed:', err.message)
      setWinnersData(null)
    }
  }, [dateRange, dateFrom, dateTo, filterAccount])

  useEffect(() => {
    if (activeTab === 'spend' || activeTab === 'general' || activeTab === 'winners') fetchSpend()
  }, [activeTab, dateRange, dateFrom, dateTo, filterAccount, fetchSpend])

  useEffect(() => {
    if (activeTab === 'winners') fetchWinners()
  }, [activeTab, dateRange, dateFrom, dateTo, filterAccount, fetchWinners])

  const handleLogout = async () => {
    try {
      if (dbMode) setStoredToken(null)
      else if (!demoMode) await api.auth.logout()
      setConnected(false)
      setDemoMode(false)
      setDbMode(false)
      setSpendData(null)
      setWinnersData(null)
      hasSetInitialTab.current = false
    } catch {}
  }

  const spendTrendDays = useMemo(() => {
    if (dateRange === 'custom') {
      const from = new Date(dateFrom)
      const to = new Date(dateTo)
      return Math.max(1, differenceInDays(to, from) + 1)
    }
    return DATE_RANGES.find((r) => r.id === dateRange)?.days ?? 30
  }, [dateRange, dateFrom, dateTo])

  // Filtrage cohérent: on filtre les campaigns puis on réagrège tout (byAccount, byProduct, byMarket, trend)
  const {
    filteredSpendByAccount,
    filteredSpendByProduct,
    spendByMarket,
    spendTrend,
    allProducts,
    allMarkets,
    allAccounts,
    rawCampaigns,
  } = useMemo(() => {
    if (spendData?.campaigns?.length) {
      let campaigns = [...spendData.campaigns]
      const getProductKey = (c) => c.productWithAnimal || (c.animal ? `${(c.productName || 'Other').trim()} ${c.animal}`.trim() : (c.productName || 'Other'))
      if (filterProduct) campaigns = campaigns.filter((c) => getProductKey(c) === filterProduct)
      if (filterModel) campaigns = campaigns.filter((c) => extractModel(c.accountName || '') === filterModel)

      const colors = ['#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4']
      const byAccount = {}
      const byProduct = {}
      const byMarket = {}
      for (const r of campaigns) {
        const accKey = r.accountName || r.accountId
        byAccount[accKey] = (byAccount[accKey] || { spend: 0, impressions: 0 })
        byAccount[accKey].spend += r.spend || 0
        byAccount[accKey].impressions += r.impressions || 0
        byAccount[accKey].accountName = r.accountName
        byAccount[accKey].accountId = r.accountId
        const prodKey = getProductKey(r)
        byProduct[prodKey] = (byProduct[prodKey] || { spend: 0, impressions: 0, clicks: 0 })
        byProduct[prodKey].spend += r.spend || 0
        byProduct[prodKey].impressions += r.impressions || 0
        byProduct[prodKey].clicks += r.clicks || 0
        byProduct[prodKey].product = prodKey
        const mktKey = r.codeCountry || 'Unknown'
        byMarket[mktKey] = (byMarket[mktKey] || { spend: 0 })
        byMarket[mktKey].spend += r.spend || 0
        byMarket[mktKey].market = mktKey
      }
      const accountList = Object.values(byAccount).map((a) => ({
        account: a.accountName || a.accountId,
        spend: Math.round(a.spend * 100) / 100,
        budget: 0,
        country: extractCountry(a.accountName),
        model: extractModel(a.accountName),
      }))
      const productList = Object.values(byProduct).map((p) => ({
        product: p.product || 'Other',
        spend: Math.round(p.spend * 100) / 100,
        impressions: p.impressions || 0,
        clicks: p.clicks || 0,
        ctr: (p.impressions || 0) > 0 ? Math.round(((p.clicks || 0) / (p.impressions || 1)) * 1000) / 10 : null,
      }))
      const marketList = Object.values(byMarket).map((m, i) => ({
        market: m.market || 'Other',
        spend: Math.round(m.spend * 100) / 100,
        fill: colors[i % colors.length],
      }))
      const byDate = {}
      for (const c of campaigns) {
        const d = c.date
        if (d && typeof d === 'string' && d.length >= 10) byDate[d] = (byDate[d] || 0) + (c.spend || 0)
      }
      const trend = Object.entries(byDate)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dateStr, spend]) => {
          const d = new Date(dateStr)
          const label = !dateStr || isNaN(d.getTime()) ? (dateStr || '-') : format(d, 'd MMM')
          return { date: label, spend: Math.round(spend * 100) / 100 }
        })
      const allProds = [...new Set(campaigns.map((c) => getProductKey(c)).filter(Boolean))].sort()
      const allMkts = [...new Set(spendData.campaigns.map((c) => c.codeCountry || '').filter(Boolean))].sort()
      const allAccounts = spendData.accounts?.length ? spendData.accounts : [...new Set(spendData.campaigns.map((c) => c.accountName || '').filter(Boolean))].sort()
      const byCampaign = {}
      for (const r of campaigns) {
        const key = r.campaignId || r.campaignName || `${r.accountName}-${r.campaignName}-${r.date}`
        if (!byCampaign[key]) {
          byCampaign[key] = { campaignName: r.campaignName || r.raw || '-', campaignId: r.campaignId, accountName: r.accountName, codeCountry: r.codeCountry || 'Unknown', product: getProductKey(r), spend: 0, impressions: 0, dateMin: r.date, dateMax: r.date }
        }
        byCampaign[key].spend += r.spend || 0
        byCampaign[key].impressions += r.impressions || 0
        if (r.date) {
          if (!byCampaign[key].dateMin || r.date < byCampaign[key].dateMin) byCampaign[key].dateMin = r.date
          if (!byCampaign[key].dateMax || r.date > byCampaign[key].dateMax) byCampaign[key].dateMax = r.date
        }
      }
      const rawCampaignsList = Object.values(byCampaign)
        .map((c) => ({ ...c, spend: Math.round(c.spend * 100) / 100 }))
        .sort((a, b) => (a.campaignName || '').localeCompare(b.campaignName || '') || b.spend - a.spend)
      return {
        filteredSpendByAccount: accountList,
        filteredSpendByProduct: productList,
        spendByMarket: marketList,
        spendTrend: trend,
        allProducts: allProds.length ? allProds : [],
        allMarkets: allMkts.length ? allMkts : [],
        allAccounts,
        rawCampaigns: rawCampaignsList,
      }
    }
    // Pas de données inventées — uniquement Meta/DB
    return {
      filteredSpendByAccount: [],
      filteredSpendByProduct: [],
      spendByMarket: [],
      spendTrend: [],
      allProducts: [],
      allMarkets: [],
      allAccounts: [],
      rawCampaigns: [],
    }
  }, [spendData, filterProduct, filterModel, filterAccount, spendTrendDays])

  const marketOptions = allMarkets || []
  const productOptions = allProducts || []
  const accountOptions = allAccounts || []


  const filteredWinners = useMemo(() => {
    const rawList = winnersData?.winners || []
    let list = [...rawList]
    if (filterAccount) {
      const mkt = extractMarketFromAccountName(filterAccount)
      if (mkt) list = list.filter((r) => (r.market || '').toUpperCase() === mkt)
    }
    if (filterProduct) list = list.filter((r) => r.product === filterProduct)
    const minSpend = Number(winnersMinSpend) || 0
    if (minSpend > 0) list = list.filter((r) => (parseFloat(r.spend) || 0) >= minSpend)
    const getVal = (r, key) => {
      if (key === 'spend') return parseFloat(r.spend) || 0
      if (key === 'impressions') return parseInt(r.impressions, 10) || 0
      if (key === 'clicks') return parseInt(r.clicks, 10) || 0
      if (key === 'ctr') return parseFloat(r.ctr) || 0
      if (key === 'roas') return typeof r.roas === 'number' ? r.roas : 0
      return String(r[key] ?? '').toLowerCase()
    }
    const mult = winnersSortDir === 'desc' ? -1 : 1
    const isNum = ['spend', 'impressions', 'clicks', 'ctr', 'roas'].includes(winnersSortBy)
    list.sort((a, b) => {
      const va = getVal(a, winnersSortBy)
      const vb = getVal(b, winnersSortBy)
      if (isNum && typeof va === 'number' && typeof vb === 'number') return mult * (vb - va)
      return mult * String(va).localeCompare(String(vb), undefined, { numeric: true })
    })
    return list.map((r, i) => ({ ...r, rank: i + 1 }))
  }, [winnersData, filterAccount, filterProduct, winnersMinSpend, winnersSortBy, winnersSortDir])

  const handleWinnersSort = (col) => {
    if (winnersSortBy === col) setWinnersSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setWinnersSortBy(col)
      setWinnersSortDir('desc')
    }
  }

  const SortTh = ({ col, label, className = '' }) => (
    <th className={className}>
      <button
        type="button"
        className="sort-th"
        onClick={() => handleWinnersSort(col)}
      >
        {label}
        {winnersSortBy === col ? (
          winnersSortDir === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
        ) : (
          <span className="sort-placeholder" />
        )}
      </button>
    </th>
  )

  const filteredStock = useMemo(() => {
    const stockData = [] // Pas de données inventées — stock non issu de Meta
    return stockData.filter((row) => {
      if (stockFilterWarehouse && row.warehouse !== stockFilterWarehouse) return false
      return true
    })
  }, [stockFilterWarehouse])

  const totalSpend = useMemo(
    () => filteredSpendByAccount.reduce((s, r) => s + r.spend, 0),
    [filteredSpendByAccount]
  )
  const totalBudget = useMemo(
    () => filteredSpendByAccount.reduce((s, r) => s + (r.budget || 0), 0),
    [filteredSpendByAccount]
  )
  const budgetPercent = totalBudget ? Math.round((totalSpend / totalBudget) * 100) : 0

  const handleRefreshFromMeta = async () => {
    if (!dbMode || !getStoredToken()) return
    setIsRefreshing(true)
    setApiError(null)
    try {
      await api.refresh()
      await fetchSpend()
      setLastUpdate(new Date())
    } catch (err) {
      setApiError(err.message || 'Refresh failed')
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleRefresh = () => {
    if (activeTab === 'spend') fetchSpend()
    if (activeTab === 'winners') fetchWinners()
    else {
      setIsLoading(true)
      setTimeout(() => setIsLoading(false), 800)
    }
  }

  const handleExportSpend = () => {
    exportToCsv(
      filteredSpendByAccount.map((r) => ({
        account: r.account,
        spend: r.spend,
        budget: r.budget || 0,
        percent: r.budget ? Math.round((r.spend / r.budget) * 100) : '-',
      })),
      [
        { key: 'account', label: 'Account' },
        { key: 'spend', label: 'Spend' },
        { key: 'budget', label: 'Budget' },
        { key: 'percent', label: '%' },
      ],
      'spend_report'
    )
  }

  const handleExportWinners = () => {
    exportToCsv(
      filteredWinners.map((r) => ({
        rank: r.rank,
        adName: r.adName,
        market: r.market,
        product: r.product,
        format: r.format,
        spend: r.spend,
        impressions: r.impressions ?? '-',
        clicks: r.clicks ?? '-',
        ctr: r.ctr != null ? `${r.ctr}%` : '-',
        roas: r.roas,
      })),
      [
        { key: 'rank', label: '#' },
        { key: 'adName', label: 'Ad Name' },
        { key: 'market', label: 'Market' },
        { key: 'product', label: 'Product' },
        { key: 'format', label: 'Format' },
        { key: 'spend', label: 'Spend' },
        { key: 'impressions', label: 'Impressions' },
        { key: 'clicks', label: 'Clicks' },
        { key: 'ctr', label: 'CTR' },
        { key: 'roas', label: 'ROAS' },
      ],
      'winners_report'
    )
  }

  const handleExportStock = () => {
    exportToCsv(
      filteredStock.map((r) => ({
        warehouse: r.warehouse,
        sku: r.sku,
        sold: r.sold,
        stock: r.stock,
        reorderAt: r.reorderAt,
        status: r.status,
        daysLeft: r.dailyAvg ? Math.round((r.stock / r.dailyAvg) * 10) / 10 : '-',
      })),
      [
        { key: 'warehouse', label: 'Warehouse' },
        { key: 'sku', label: 'SKU' },
        { key: 'sold', label: 'Sold' },
        { key: 'stock', label: 'Stock' },
        { key: 'reorderAt', label: 'Reorder at' },
        { key: 'status', label: 'Status' },
      ],
      'stock_report'
    )
  }

  if (!authChecked) {
    return (
      <div className="app theme-dark">
        <div className="loading-page">
          <div className="loading-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="app app-login theme-dark">
        <Login onLogin={({ isDemo, user, dbMode: db }) => {
          setConnected(true)
          setDemoMode(isDemo ?? false)
          setDbMode(!!db)
          if (user) setCurrentUser(user)
          else if (isDemo) setCurrentUser({ id: 'demo', name: 'Demo', role: 'admin', pages: ['spend', 'stock', 'winners', 'general'] })
        }} />
      </div>
    )
  }

  return (
    <div className={`app theme-${theme} ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {isRefreshing && (
        <div className="sync-overlay" role="alert" aria-live="polite">
          <div className="sync-overlay-content">
            <RefreshCw size={48} className="sync-spinner" />
            <h3>Synchronisation en cours…</h3>
            <p>Ne quittez pas cette page. Le chargement des données peut prendre plusieurs minutes.</p>
          </div>
        </div>
      )}
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(true)}
        title="Open menu"
        aria-label="Open menu"
      >
        <Menu size={24} />
      </button>
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <button
          className="sidebar-close-btn"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
          title="Close"
        >
          <X size={20} />
        </button>
        <div className="logo">
          <span className="logo-icon">VP</span>
          <span className="logo-text">Advertising Report</span>
        </div>
        <nav className="nav">
          {visibleSidebarItems.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-section-title">{section.title}</div>
              {section.items.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`nav-btn ${activeTab === id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab(id)
                    setSidebarOpen(false)
                  }}
                  title={label}
                >
                  {Icon && <Icon size={20} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button
            className="theme-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className={`refresh-btn ${isLoading ? 'loading' : ''}`}
            onClick={handleRefresh}
            title="Refresh"
          >
            <RefreshCw size={18} />
          </button>
          <button className="logout-btn" onClick={handleLogout} title="Disconnect">
            <LogOut size={18} />
          </button>
        </div>
        {isAdmin && !dbMode && (
          <div className="user-switcher">
            <span className="user-switcher-label">{currentUser?.name || 'Demo'}</span>
          </div>
        )}
        <div className="sidebar-footer">
          <span className="last-update">Last update: {lastUpdate instanceof Date && !isNaN(lastUpdate.getTime()) ? format(lastUpdate, 'dd/MM HH:mm') : '—'}</span>
          <span className="refresh-badge">~30 min</span>
        </div>
      </aside>

      <main className="main">
        {demoMode && (
          <div className="demo-banner">
            <span>Demo mode — sample data (CBO_ES_SMART_BALL_CAT_BASIC_20250216, etc.)</span>
          </div>
        )}
        <header className="header">
          <div className="header-left">
            <h1>
              {activeTab === 'spend' && 'Reporting Ads Manager — Spend'}
              {activeTab === 'winners' && 'Winners — Ads by spend & ROAS'}
              {activeTab === 'stock' && 'Stock'}
              {activeTab === 'general' && 'General — Vue globale'}
              {activeTab === 'admin' && 'Administration — Members'}
              {activeTab === 'settings' && 'Settings — Meta token'}
            </h1>
            <div className="header-date">{format(new Date(), 'EEEE, MMMM d, yyyy')}</div>
          </div>
        </header>

        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <span>Loading...</span>
          </div>
        )}

        {apiError && (activeTab === 'spend' || activeTab === 'general') && (
          <div className="api-error-banner">
            <span>{apiError}</span>
            <button onClick={fetchSpend}>Retry</button>
          </div>
        )}

        {activeTab === 'spend' && (
          <div className="content spend-content">
            <section className="toolbar">
              <div className="filters-row">
                <div className="filter-group">
                  <Calendar size={16} />
                  {DATE_RANGES.map((r) => (
                    <button
                      key={r.id}
                      className={`filter-chip ${dateRange === r.id ? 'active' : ''}`}
                      onClick={() => setDateRange(r.id)}
                    >
                      {r.label}
                    </button>
                  ))}
                  {dateRange === 'custom' && (
                    <div className="date-range-inputs">
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        max={dateTo}
                        className="date-input"
                      />
                      <span className="date-sep">→</span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        min={dateFrom}
                        max={format(new Date(), 'yyyy-MM-dd')}
                        className="date-input"
                      />
                    </div>
                  )}
                </div>
                <div className="filter-group">
                  <Filter size={16} />
                  <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} title="Ad Account (market)">
                    <option value="">All ad accounts</option>
                    {accountOptions.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                  <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} title="Product">
                    <option value="">All products</option>
                    {productOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <select value={filterModel} onChange={(e) => setFilterModel(e.target.value)} title="Model">
                    <option value="">COD / DROP</option>
                    <option value="COD">COD</option>
                    <option value="DROP">DROP</option>
                  </select>
                </div>
                {dbMode && (
                  <button
                    className={`export-btn refresh-meta-btn accent ${isRefreshing ? 'loading' : ''}`}
                    onClick={handleRefreshFromMeta}
                    disabled={isRefreshing}
                    title="Fetch from Meta API and update database"
                  >
                    <RefreshCw size={16} />
                    {isRefreshing ? 'Syncing…' : 'Refresh from Meta'}
                  </button>
                )}
                <button className="export-btn" onClick={handleExportSpend}>
                  <Download size={16} />
                  Export CSV
                </button>
              </div>
            </section>

            <section className="cards-row">
              <div className="stat-card">
                <div className="stat-card-label">Total Spend</div>
                <div className="stat-card-value">${totalSpend.toLocaleString()}</div>
                <div className="stat-card-sub">
                  {totalBudget ? `of $${totalBudget.toLocaleString()} budget` : 'from Meta API'}
                </div>
              </div>
              <div className={`stat-card ${budgetPercent >= 90 && totalBudget ? 'alert' : 'accent'}`}>
                <div className="stat-card-label">Budget used</div>
                <div className="stat-card-value">{totalBudget ? `${budgetPercent}%` : '-'}</div>
                <div className="stat-card-sub">{filteredSpendByAccount.length} accounts</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Avg Spend / Account</div>
                <div className="stat-card-value">
                  ${filteredSpendByAccount.length ? Math.round(totalSpend / filteredSpendByAccount.length).toLocaleString() : 0}
                </div>
              </div>
            </section>

            <div className="charts-grid">
              <section className="chart-section">
                <h3>Spend Trend {dateRange === 'custom' ? `(${dateFrom} → ${dateTo})` : dateRange === 'full' ? '(Full)' : `(${spendTrendDays} days)`}</h3>
                <div className="chart-wrapper" key={`trend-${totalSpend}-${(spendTrend || []).length}`}>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={Array.isArray(spendTrend) ? spendTrend : []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: 'currentColor' }} fontSize={12} />
                      <YAxis
                        domain={[0, (dataMax) => Math.ceil((dataMax || 0) / 1000) * 1000 || 1000]}
                        ticks={(() => {
                          const max = Math.max(0, ...(spendTrend || []).map((d) => d.spend || 0))
                          const yMax = Math.ceil(max / 1000) * 1000 || 1000
                          const step = Math.ceil(yMax / 5 / 1000) * 1000 || 1000
                          const t = []
                          for (let i = 0; i <= yMax; i += step) t.push(i)
                          return t.length ? t : [0, 1000]
                        })()}
                        tick={{ fill: 'currentColor' }}
                        fontSize={12}
                        tickFormatter={(v) => `$${v / 1000}k`}
                      />
                      <Tooltip
                        contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', borderRadius: 8 }}
                        formatter={(v) => [`$${v?.toLocaleString?.() ?? v}`, 'Spend']}
                      />
                      <Line type="monotone" dataKey="spend" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className="chart-section">
                <h3>Breakdown by Market</h3>
                {(() => {
                  const marketData = Array.isArray(spendByMarket) && spendByMarket.length ? spendByMarket : [{ market: 'No data', spend: 0, fill: '#444' }]
                  const marketTotal = marketData.reduce((s, m) => s + (m.spend || 0), 0)
                  return (
                    <>
                      <p className="chart-total">Total: ${marketTotal.toLocaleString()}</p>
                      <div className="chart-wrapper pie-chart" key={`market-${totalSpend}-${marketData.length}`}>
                        <ResponsiveContainer width="100%" height={280}>
                          <PieChart>
                            <Pie
                              data={marketData}
                              dataKey="spend"
                              nameKey="market"
                              cx="50%"
                              cy="50%"
                              outerRadius={90}
                              label={({ market, spend }) => `${market} ${marketTotal > 0 ? Math.round(((spend || 0) / marketTotal) * 100) : 0}%`}
                            >
                              {marketData.map((entry, i) => (
                                <Cell key={i} fill={entry.fill || '#f59e0b'} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', borderRadius: 8 }}
                              formatter={(v) => [`$${v?.toLocaleString?.() ?? v}`, 'Spend']}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )
                })()}
              </section>
            </div>

            <div className="tables-grid">
              <section className="table-section">
                <h3>By Ad Account</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Spend</th>
                        <th>Budget</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSpendByAccount.map((row, i) => (
                        <tr key={row.account || `acc-${i}`}>
                          <td>
                            <span className="account-name">{row.account}</span>
                            <span className="account-meta">{(row.country || '') + (row.model ? ` · ${row.model}` : '')}</span>
                          </td>
                          <td className="num">${row.spend.toLocaleString()}</td>
                          <td className="num">{row.budget ? `$${row.budget.toLocaleString()}` : '-'}</td>
                          <td>
                            <div className="progress-cell">
                              <div
                                className={`progress-bar-track ${row.budget && (row.spend / row.budget) >= 0.9 ? 'alert' : ''}`}
                              >
                                <div
                                  className="progress-fill"
                                  style={{ width: `${row.budget ? Math.min((row.spend / row.budget) * 100, 100) : 0}%` }}
                                />
                              </div>
                              <span className="progress-value">
                                {row.budget ? `${Math.round((row.spend / row.budget) * 100)}%` : '-'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="table-section">
                <h3>By Product</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Spend</th>
                        <th>Impressions</th>
                        <th>CTR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSpendByProduct.map((row, i) => (
                        <tr key={row.product || `prod-${i}`}>
                          <td>{row.product}</td>
                          <td className="num">${row.spend.toLocaleString()}</td>
                          <td className="num">{(row.impressions / 1e6).toFixed(2)}M</td>
                          <td className="num">{row.ctr ? `${row.ctr}%` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {rawCampaigns?.length > 0 && (
              <section className="table-section full-width">
                <h3>All campaigns (raw, like Meta)</h3>
                <div className="table-wrap raw-campaigns-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Campaign name</th>
                        <th className="num">Market</th>
                        <th className="num">Product</th>
                        <th className="num">Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rawCampaigns.map((row, i) => (
                        <tr key={row.campaignId || `raw-${i}`}>
                          <td>
                            <span className="campaign-name-raw">{row.campaignName}</span>
                          </td>
                          <td className="num"><span className="market-tag">{row.codeCountry}</span></td>
                          <td className="num">{row.product}</td>
                          <td className="num">${row.spend.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'winners' && (
          <div className={`content winners-content ${selectedWinner ? 'has-detail' : ''}`}>
            <section className="toolbar">
              <div className="filters-row">
                <div className="filter-group">
                  <Calendar size={16} />
                  {DATE_RANGES.filter((r) => r.id !== 'custom').map((r) => (
                    <button
                      key={r.id}
                      className={`filter-chip ${dateRange === r.id ? 'active' : ''}`}
                      onClick={() => setDateRange(r.id)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="filter-group">
                  <Filter size={16} />
                  <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} title="Ad Account (market)">
                    <option value="">All ad accounts</option>
                    {accountOptions.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                  <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} title="Product">
                    <option value="">All products</option>
                    {productOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <label className="min-spend-filter" title="Spend minimum en $">
                    Min $
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={winnersMinSpend}
                      onChange={(e) => setWinnersMinSpend(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </label>
                </div>
                <button className="export-btn" onClick={handleExportWinners}>
                  <Download size={16} />
                  Export CSV
                </button>
              </div>
            </section>
            <section className="intro-card">
              <TrendingUp size={24} />
      <div>
                <h3>All ads by spend & ROAS</h3>
                <p>From Ads Manager — near real-time update (~30 min)</p>
              </div>
            </section>
            <section className="table-section full-width">
              {filteredWinners.length === 0 && (
                <p className="empty-state-msg">Aucune donnée winners — synchronisez depuis Meta (winners.json ou API).</p>
              )}
              <div className="table-wrap">
                <table className="winners-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <SortTh col="adName" label="Ad Name" />
                      <SortTh col="market" label="Market" />
                      <SortTh col="product" label="Product" />
                      <SortTh col="format" label="Format" />
                      <SortTh col="spend" label="Spend" className="num" />
                      <SortTh col="impressions" label="Impressions" className="num" />
                      <SortTh col="clicks" label="Clicks" className="num" />
                      <SortTh col="ctr" label="CTR" className="num" />
                      <SortTh col="roas" label="ROAS" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWinners.map((row) => (
                      <tr
                        key={row.rank}
                        className="clickable"
                        onClick={() => setSelectedWinner(row)}
                      >
                        <td><span className="rank-badge">{row.rank}</span></td>
                        <td><code className="ad-name">{row.adName}</code></td>
                        <td><span className="market-tag">{row.market}</span></td>
                        <td>{row.product}</td>
                        <td><span className="format-badge">{row.format}</span></td>
                        <td className="num">${row.spend.toLocaleString()}</td>
                        <td className="num">{(row.impressions || 0).toLocaleString()}</td>
                        <td className="num">{(row.clicks || 0).toLocaleString()}</td>
                        <td className="num">{row.ctr != null ? `${row.ctr}%` : '-'}</td>
                        <td>
                          <span className={`roas-badge ${typeof row.roas === 'number' && row.roas >= 2.5 ? 'high' : ''}`}>
                            {typeof row.roas === 'number' ? `${row.roas}x` : (row.roas ?? '-')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {selectedWinner && (
              <aside className="winner-detail-panel">
                <div className="winner-detail-header">
                  <h3>Ad details</h3>
                  <button className="close-btn" onClick={() => setSelectedWinner(null)}>
                    <X size={20} />
                  </button>
                </div>
                <WinnerDetailContent winner={selectedWinner} />
              </aside>
            )}
          </div>
        )}

        {activeTab === 'general' && (() => {
          const totalSpendGeneral = filteredSpendByAccount?.reduce((s, r) => s + (r.spend || 0), 0) || 0
          const totalImpressions = filteredSpendByProduct?.reduce((s, r) => s + (r.impressions || 0), 0) || 0
          const totalClicks = filteredSpendByProduct?.reduce((s, r) => s + (r.clicks || 0), 0) || 0
          const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : null
          const topMarket = [...(spendByMarket || [])].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0]
          const topProduct = [...(filteredSpendByProduct || [])].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0]
          const top5Products = [...(filteredSpendByProduct || [])].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5)
          const top5Accounts = [...(filteredSpendByAccount || [])].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5)
          const campaignCount = rawCampaigns?.length || 0
          const marketCount = spendByMarket?.length || 0

          const insights = []
          if (topMarket && totalSpendGeneral > 0) {
            const pct = ((topMarket.spend / totalSpendGeneral) * 100).toFixed(0)
            insights.push({ text: `${topMarket.market} représente ${pct}% du spend total`, icon: 'market' })
          }
          if (topProduct && totalSpendGeneral > 0) {
            const pct = ((topProduct.spend / totalSpendGeneral) * 100).toFixed(0)
            insights.push({ text: `${topProduct.product} est le produit le plus investi (${pct}%)`, icon: 'product' })
          }
          if (marketCount > 0) insights.push({ text: `${marketCount} marchés actifs sur la période`, icon: 'globe' })
          if (campaignCount > 0) insights.push({ text: `${campaignCount} campagnes avec du spend`, icon: 'campaign' })
          if (avgCtr != null) insights.push({ text: `CTR moyen : ${avgCtr}%`, icon: 'ctr' })

          return (
          <div className="content general-content">
            <section className="toolbar general-toolbar">
              <div className="filters-row">
                <div className="filter-group">
                  <Calendar size={16} />
                  {DATE_RANGES.map((r) => (
                    <button key={r.id} className={`filter-chip ${dateRange === r.id ? 'active' : ''}`} onClick={() => setDateRange(r.id)}>
                      {r.label}
                    </button>
                  ))}
                  {dateRange === 'custom' && (
                    <div className="date-range-inputs">
                      <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={dateTo} className="date-input" />
                      <span className="date-sep">→</span>
                      <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} min={dateFrom} max={format(new Date(), 'yyyy-MM-dd')} className="date-input" />
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="intro-card general-intro">
              <Sparkles size={32} />
              <div>
                <h3>General — Vue globale</h3>
                <p>Synthèse des opérations marketing sur la période sélectionnée.</p>
              </div>
            </div>

            <section className="cards-row general-cards">
              <div className="stat-card accent">
                <div className="stat-card-label">Total Spend</div>
                <div className="stat-card-value">${totalSpendGeneral.toLocaleString()}</div>
                <div className="stat-card-sub">{filteredSpendByAccount?.length || 0} ad accounts</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Impressions</div>
                <div className="stat-card-value">{(totalImpressions / 1e6).toFixed(2)}M</div>
                <div className="stat-card-sub">{totalClicks.toLocaleString()} clics</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">CTR moyen</div>
                <div className="stat-card-value">{avgCtr ? `${avgCtr}%` : '—'}</div>
                <div className="stat-card-sub">{campaignCount} campagnes</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Top marché</div>
                <div className="stat-card-value">{topMarket?.market || '—'}</div>
                <div className="stat-card-sub">{topMarket ? `$${(topMarket.spend || 0).toLocaleString()}` : 'N/A'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Top produit</div>
                <div className="stat-card-value">{topProduct ? (topProduct.product?.length > 15 ? topProduct.product.slice(0, 15) + '…' : topProduct.product) : '—'}</div>
                <div className="stat-card-sub">{topProduct ? `$${(topProduct.spend || 0).toLocaleString()}` : 'N/A'}</div>
              </div>
            </section>

            <div className="general-grid">
              <section className="chart-section general-chart">
                <h3>Évolution du spend</h3>
                <div className="chart-wrapper" key={`general-trend-${totalSpendGeneral}-${(spendTrend || []).length}`}>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={Array.isArray(spendTrend) ? spendTrend : []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: 'currentColor' }} fontSize={11} />
                      <YAxis
                        domain={[0, (dataMax) => Math.ceil((dataMax || 0) / 1000) * 1000 || 1000]}
                        ticks={(() => {
                          const max = Math.max(0, ...(spendTrend || []).map((d) => d.spend || 0))
                          const yMax = Math.ceil(max / 1000) * 1000 || 1000
                          const step = Math.ceil(yMax / 5 / 1000) * 1000 || 1000
                          const t = []
                          for (let i = 0; i <= yMax; i += step) t.push(i)
                          return t.length ? t : [0, 1000]
                        })()}
                        tick={{ fill: 'currentColor' }}
                        fontSize={11}
                        tickFormatter={(v) => `$${v / 1000}k`}
                      />
                      <Tooltip contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', borderRadius: 8 }} formatter={(v) => [`$${v?.toLocaleString?.() ?? v}`, 'Spend']} />
                      <Line type="monotone" dataKey="spend" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className="chart-section general-chart">
                <h3>Répartition par marché</h3>
                {(() => {
                  const marketData = Array.isArray(spendByMarket) && spendByMarket.length ? spendByMarket : [{ market: 'No data', spend: 0, fill: '#444' }]
                  const marketTotal = marketData.reduce((s, m) => s + (m.spend || 0), 0)
                  return (
                    <>
                      <p className="chart-total">Total: ${marketTotal.toLocaleString()}</p>
                      <div className="chart-wrapper pie-chart" key={`general-market-${totalSpendGeneral}-${marketData.length}`}>
                        <ResponsiveContainer width="100%" height={240}>
                          <PieChart>
                            <Pie
                              data={marketData}
                              dataKey="spend"
                              nameKey="market"
                              cx="50%"
                              cy="50%"
                              outerRadius={75}
                              label={({ market, spend }) => `${market} ${marketTotal > 0 ? Math.round(((spend || 0) / marketTotal) * 100) : 0}%`}
                            >
                              {marketData.map((entry, i) => (
                                <Cell key={i} fill={entry.fill || '#f59e0b'} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', borderRadius: 8 }} formatter={(v) => [`$${v?.toLocaleString?.() ?? v}`, 'Spend']} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )
                })()}
              </section>
            </div>

            <div className="general-tables-row">
              <section className="table-section general-table">
                <h3>Top 5 produits</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Produit</th><th className="num">Spend</th><th className="num">CTR</th></tr>
                    </thead>
                    <tbody>
                      {top5Products.map((r, i) => (
                        <tr key={i}>
                          <td>{r.product}</td>
                          <td className="num">${(r.spend || 0).toLocaleString()}</td>
                          <td className="num">{r.ctr ? `${r.ctr}%` : '—'}</td>
                        </tr>
                      ))}
                      {top5Products.length === 0 && <tr><td colSpan={3} className="empty">Aucune donnée</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="table-section general-table">
                <h3>Top 5 ad accounts</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Account</th><th className="num">Spend</th></tr>
                    </thead>
                    <tbody>
                      {top5Accounts.map((r, i) => (
                        <tr key={i}>
                          <td><span className="account-name">{r.account}</span></td>
                          <td className="num">${(r.spend || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      {top5Accounts.length === 0 && <tr><td colSpan={2} className="empty">Aucune donnée</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {insights.length > 0 && (
              <section className="general-insights">
                <h3>Points clés</h3>
                <ul>
                  {insights.map((item, i) => (
                    <li key={i}>{item.text}</li>
                  ))}
                </ul>
              </section>
            )}

            <div className="general-ai-card">
              <h3><Sparkles size={20} /> IA recommendations</h3>
              <p>Bientôt disponible : une IA avec vue globale sur les opérations marketing — feedback, suggestions, reconnaissance de patterns (formats gagnants, marchés sous-optimisés).</p>
            </div>
          </div>
          )
        })()}

        {activeTab === 'admin' && (
          <div className="content admin-content">
            <Admin dbMode={dbMode} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="content settings-content">
            <Settings />
          </div>
        )}

        {activeTab === 'stock' && (
          <div className="content stock-content">
            <section className="toolbar">
              <div className="filters-row">
                <div className="filter-group">
                  <Filter size={16} />
                  <select value={stockFilterWarehouse} onChange={(e) => setStockFilterWarehouse(e.target.value)}>
                    <option value="">All warehouses</option>
                    {[].map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <button className="export-btn" onClick={handleExportStock}>
                  <Download size={16} />
                  Export Stock
                </button>
              </div>
            </section>
            <section className="alerts-section">
              <h3>Alerts & Suggested Actions</h3>
              <div className="alerts-grid">
                {[].map((alert) => (
                  <div
                    key={`${alert.sku}-${alert.warehouse}`}
                    className={`alert-card ${alert.action === 'Order stock' ? 'critical' : 'warning'}`}
                  >
                    <span className="alert-sku">{alert.sku}</span>
                    <span className="alert-warehouse">{alert.warehouse}</span>
                    <span className="alert-stock">{alert.stock} units</span>
                    <span className="alert-action">{alert.action}</span>
                    <span className="alert-suggested">{alert.suggested}</span>
                    {alert.daysLeft && (
                      <span className="alert-days">~{alert.daysLeft} days left</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section className="table-section">
              <h3>Stock by Warehouse (J+7 projection)</h3>
              {filteredStock.length === 0 && (
                <p className="empty-state-msg">Aucune donnée stock — les données stock ne proviennent pas de Meta.</p>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Warehouse</th>
                      <th>SKU</th>
                      <th>Sold</th>
                      <th>Stock</th>
                      <th>Reorder at</th>
                      <th>Est. J+7</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStock.map((row, i) => {
                      const stockJ7 = row.dailyAvg ? Math.max(0, row.stock - row.dailyAvg * 7) : '-'
                      return (
                        <tr key={i}>
                          <td><span className="warehouse-tag">{row.warehouse}</span></td>
                          <td>{row.sku}</td>
                          <td className="num">{row.sold.toLocaleString()}</td>
                          <td className="num">{row.stock.toLocaleString()}</td>
                          <td className="num">{row.reorderAt}</td>
                          <td className="num">{typeof stockJ7 === 'number' ? Math.round(stockJ7) : stockJ7}</td>
                          <td>
                            <span className={`status-badge status-${row.status}`}>
                              {row.status === 'ok' && 'OK'}
                              {row.status === 'warning' && 'Monitor'}
                              {row.status === 'critical' && 'Order'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

function WinnerDetailContent({ winner }) {
  const parsed = parseAdName(winner.adName)
  return (
    <div className="winner-detail-body">
      <div className="winner-detail-section">
        <h4>Metrics</h4>
        <dl>
          <dt>Rank</dt><dd>{winner.rank}</dd>
          <dt>Market</dt><dd><span className="market-tag">{winner.market}</span></dd>
          <dt>Product</dt><dd>{winner.product}</dd>
          <dt>Spend</dt><dd>${winner.spend?.toLocaleString?.()}</dd>
          <dt>ROAS</dt><dd><span className={`roas-badge ${winner.roas >= 2.5 ? 'high' : ''}`}>{winner.roas}x</span></dd>
          <dt>CTR</dt><dd>{winner.ctr ? `${winner.ctr}%` : '-'}</dd>
        </dl>
      </div>
      <div className="winner-detail-section">
        <h4>Naming convention</h4>
        <p className="naming-legend">#_code country_product name_target_offer_concept_type_format</p>
        <code className="ad-name-full">{winner.adName}</code>
      </div>
      <div className="winner-detail-section">
        <h4>Parsed fields</h4>
        <dl>
          <dt>ID</dt><dd>{parsed.id}</dd>
          <dt>Code country</dt><dd>{parsed.codeCountry}</dd>
          <dt>Product name</dt><dd>{parsed.productName}</dd>
          <dt>Concept</dt><dd>{parsed.concept}</dd>
          <dt>Type</dt><dd>{parsed.type}</dd>
          <dt>Format</dt><dd><span className="format-badge">{parsed.format}</span></dd>
        </dl>
      </div>
    </div>
  )
}

function extractCountry(name) {
  if (!name) return ''
  // Convention: VELUNAPETS [CODE] [MODEL] [CURRENCY] — 2e token = market
  const parts = name.trim().split(/\s+/)
  const code = parts[1]
  if (code && code.length >= 2 && code.length <= 3) return code.toUpperCase()
  return ''
}

/** Extract market code from account name — CBO_MX_... → MX, or VELUNAPETS SI COD → SI */
function extractMarketFromAccountName(name) {
  if (!name || typeof name !== 'string') return ''
  const s = name.trim()
  const underscoreParts = s.split('_')
  if (underscoreParts.length >= 2 && /^(CBO|ABO)$/i.test(underscoreParts[0])) {
    const code = (underscoreParts[1] || '').toUpperCase()
    if (/^[A-Z]{2,3}$/.test(code)) return code
  }
  const spaceParts = s.split(/\s+/)
  const code = (spaceParts[1] || '').toUpperCase()
  if (code.length >= 2 && code.length <= 3) return code
  return ''
}

function extractModel(name) {
  if (!name) return ''
  return name.toUpperCase().includes('DROP') ? 'DROP' : name.toUpperCase().includes('COD') ? 'COD' : ''
}

export default App
