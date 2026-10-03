import { createContext, useContext, useEffect, useState } from 'react';
import { api, setCsrf } from '../services/api.js';

const AuthContext=createContext(null);
export function AuthProvider({children}) {
  const [user,setUser]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  async function refresh() {
    setLoading(true); setError('');
    try { const {data}=await api('/auth/me'); setUser(data.user);setCsrf(data.csrfToken); }
    catch(e) { setUser(null);if(e.status!==401) setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(()=>{refresh();},[]);
  async function authenticate(mode,values) {
    const {data}=await api(`/auth/${mode}`,{method:'POST',body:values});
    setUser(data.user);setCsrf(data.csrfToken);setError('');
  }
  async function logout() { await api('/auth/logout',{method:'POST'});setUser(null);setCsrf(null); }
  return <AuthContext.Provider value={{user,loading,error,refresh,authenticate,logout}}>{children}</AuthContext.Provider>;
}
export function useAuth(){return useContext(AuthContext);}
