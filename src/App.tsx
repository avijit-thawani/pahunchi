import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { History, Phone, Users } from 'lucide-react'
import QuickCallPage from './pages/QuickCallPage.tsx'
import HomePage from './pages/HomePage.tsx'
import CallPage from './pages/CallPage.tsx'
import AfterCallPage from './pages/AfterCallPage.tsx'
import HistoryPage from './pages/HistoryPage.tsx'
import ContactsPage from './pages/ContactsPage.tsx'
import JoinPage from './pages/JoinPage.tsx'
import PrivacyPage from './pages/PrivacyPage.tsx'
import IncomingPage from './pages/IncomingPage.tsx'
import { useRingWhenDue } from './lib/later.ts'
function Nav() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/call') || pathname.startsWith('/incoming') || pathname === '/go') return null
  const item = (to: string, label: string, Icon: typeof Phone) => {
    const active = to === '/' ? pathname === '/' : pathname.startsWith(to)
    return (
      <NavLink
        to={to}
        end
        data-active={active}
        className={`nav-tab flex flex-col items-center justify-center flex-1 h-full transition-colors ${
          active ? 'text-secondary bg-base-300/40' : 'text-base-content/60'
        }`}
      >
        <Icon className="nav-tab-icon w-6 h-6" />
        <span className={`text-xs mt-1 ${active ? 'font-extrabold' : 'font-semibold'}`}>{label}</span>
      </NavLink>
    )
  }
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-base-200 border-t-2 border-base-300 z-50 safe-bottom">
      <div className="flex justify-around items-center h-16 max-w-md mx-auto">
        {item('/', 'Call', Phone)}
        {item('/history', 'History', History)}
        {item('/contacts', 'Contacts', Users)}
      </div>
    </nav>
  )
}

function RingWhenDue() {
  useRingWhenDue()
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <RingWhenDue />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/go" element={<QuickCallPage />} />
        <Route path="/call" element={<CallPage />} />
        <Route path="/incoming" element={<IncomingPage />} />
        <Route path="/after/:id" element={<AfterCallPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Routes>
      <Nav />
    </BrowserRouter>
  )
}
