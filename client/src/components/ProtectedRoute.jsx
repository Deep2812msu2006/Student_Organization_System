import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({role}) {
  const {user,loading,error,refresh}=useAuth();
  if(loading) return <div className="container account-page" role="status">Checking your session…</div>;
  if(error) return <div className="container account-page"><h1>Connection needs attention</h1><p role="alert">{error}</p><button className="button" onClick={refresh}>Try again</button></div>;
  if(!user) return <Navigate to="/login" replace/>;
  const allowed = role ? (Array.isArray(role) ? role : [role]).some(r => user.roles?.includes(r)) : true;
  if(!allowed) return <div className="container account-page"><h1>Access restricted</h1><p>Your account does not have the required staff role.</p></div>;
  return <Outlet/>;
}
