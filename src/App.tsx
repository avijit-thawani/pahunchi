import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { History, Phone, Users } from 'lucide-react'
import HomePage from './pages/HomePage.tsx'
import CallPage from './pages/CallPage.tsx'
import AfterCallPage from './pages/AfterCallPage.tsx'
import HistoryPage from './pages/HistoryPage.tsx'
import ContactsPage from './pages/ContactsPage.tsx'

function Nav() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/call') || pathname.startsWith('/after')) return null
  const item = (to: string, label: string, Icon: typeof Phone) => (
    <NavLink to={to} end className={({ isActive }) => `flex flex-col items-center gap-0.5 text-xs ${isActive ? 'text-primary' : 'opacity-60'}`}>
      <Icon size={20} />
      {label}
    </NavLink>
  )
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-base-200 border-t border-base-300 flex justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {item('/', 'Call', Phone)}
      {item('/history', 'History', History)}
      {item('/contacts', 'Contacts', Users)}
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/call" element={<CallPage />} />
        <Route path="/after/:id" element={<AfterCallPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
      </Routes>
      <Nav />
    </BrowserRouter>
  )
}
