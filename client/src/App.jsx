import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import PublicLayout from './layouts/PublicLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import AuthPage from './pages/auth/AuthPage.jsx';
import MembershipPage from './pages/members/MembershipPage.jsx';
import MemberDirectory from './pages/members/MemberDirectory.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import './styles/account.css';

function ScrollToPage(){const {pathname,hash}=useLocation();useEffect(()=>{if(hash)document.getElementById(hash.slice(1))?.scrollIntoView();else window.scrollTo(0,0);},[pathname,hash]);return null;}
export default function App(){return <BrowserRouter><AuthProvider><PublicLayout><ScrollToPage/><Routes>
  <Route path="/" element={<HomePage/>}/>
  <Route path="/login" element={<AuthPage key="login" mode="login"/>}/>
  <Route path="/register" element={<AuthPage key="register" mode="register"/>}/>
  <Route element={<ProtectedRoute/>}><Route path="/membership" element={<MembershipPage/>}/></Route>
  <Route element={<ProtectedRoute role="organizer"/>}><Route path="/members" element={<MemberDirectory/>}/></Route>
  <Route path="*" element={<section className="container account-page"><h1>Page not found</h1><Link className="button" to="/">Back to home</Link></section>}/>
</Routes></PublicLayout></AuthProvider></BrowserRouter>;}
