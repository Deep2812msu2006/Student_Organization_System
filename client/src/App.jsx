import SearchPage from './pages/SearchPage.jsx';
import './styles/search.css';
import InventoryPage from './pages/staff/InventoryPage.jsx';
import AnnouncementsPage from './pages/community/AnnouncementsPage.jsx';
import TasksPage from './pages/community/TasksPage.jsx';
import MailPage from './pages/community/MailPage.jsx';
import FinancePage from './pages/staff/FinancePage.jsx';
import DuesPage from './pages/staff/DuesPage.jsx';
import ExpensesPage from './pages/staff/ExpensesPage.jsx';
import './styles/modules.css';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import PublicLayout from './layouts/PublicLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import AuthPage from './pages/auth/AuthPage.jsx';
import MembershipPage from './pages/members/MembershipPage.jsx';
import MemberDirectory from './pages/members/MemberDirectory.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import './styles/account.css';
import './styles/events.css';
import './styles/staff.css';
import './styles/shop.css';
import EventsPage from './pages/events/EventsPage.jsx';
import EventDetails from './pages/events/EventDetails.jsx';
import EventForm from './pages/events/EventForm.jsx';
import TicketsPage from './pages/events/TicketsPage.jsx';
import CheckInPage from './pages/staff/CheckInPage.jsx';
import PaymentPage from './pages/staff/PaymentPage.jsx';
import ShopPage from './pages/shop/ShopPage.jsx';
import ProductDetailPage from './pages/shop/ProductDetailPage.jsx';
import CartPage from './pages/shop/CartPage.jsx';
import OrdersPage from './pages/shop/OrdersPage.jsx';
import OrderDetailPage from './pages/shop/OrderDetailPage.jsx';

function ScrollToPage(){const {pathname,hash}=useLocation();useEffect(()=>{if(hash)document.getElementById(hash.slice(1))?.scrollIntoView();else window.scrollTo(0,0);},[pathname,hash]);return null;}
export default function App(){return <BrowserRouter><AuthProvider><CartProvider><PublicLayout><ScrollToPage/><Routes>
  <Route path="/" element={<HomePage/>}/><Route path="/search" element={<SearchPage/>}/>
  <Route path="/shop" element={<ShopPage/>}/>
  <Route path="/shop/:id" element={<ProductDetailPage/>}/>
  <Route path="/cart" element={<CartPage/>}/>
  <Route element={<ProtectedRoute/>}><Route path="/orders" element={<OrdersPage/>}/><Route path="/orders/:id" element={<OrderDetailPage/>}/></Route>
  <Route path="/events" element={<EventsPage/>}/><Route path="/events/:id" element={<EventDetails/>}/><Route element={<ProtectedRoute/>}><Route path="/tickets" element={<TicketsPage/>}/></Route><Route element={<ProtectedRoute role="organizer"/>}><Route path="/organizer/events" element={<EventsPage manage/>}/><Route path="/events/new" element={<EventForm key="new"/>}/><Route path="/events/:id/edit" element={<EventForm/>}/><Route path="/staff/checkin" element={<CheckInPage/>}/></Route>
  <Route path="/announcements" element={<AnnouncementsPage/>}/>
<Route element={<ProtectedRoute/>}><Route path="/tasks" element={<TasksPage/>}/><Route path="/mail" element={<MailPage/>}/><Route path="/expenses" element={<ExpensesPage/>}/></Route>
<Route element={<ProtectedRoute role={['organizer','treasurer']}/>}>
<Route path="/staff/payments" element={<PaymentPage/>}/><Route path="/staff/dues" element={<DuesPage/>}/><Route path="/finance" element={<FinancePage/>}/></Route>
<Route element={<ProtectedRoute role="organizer"/>}><Route path="/staff/inventory" element={<InventoryPage/>}/><Route path="/staff/mail" element={<MailPage staff/>}/></Route>
<Route path="/login" element={<AuthPage key="login" mode="login"/>}/>
  <Route path="/register" element={<AuthPage key="register" mode="register"/>}/>
  <Route element={<ProtectedRoute/>}><Route path="/membership" element={<MembershipPage/>}/></Route>
  <Route element={<ProtectedRoute role="organizer"/>}><Route path="/members" element={<MemberDirectory/>}/></Route>
  <Route path="*" element={<section className="container account-page"><h1>Page not found</h1><Link className="button" to="/">Back to home</Link></section>}/>
</Routes></PublicLayout></CartProvider></AuthProvider></BrowserRouter>;}
