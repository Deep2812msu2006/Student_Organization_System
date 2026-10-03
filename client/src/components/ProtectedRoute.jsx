import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({role}) {
  const {user,loading,error,refresh}=useAuth();
  if(loading) return <div className="container account-page" role="status">Checking your session…</div>;
  if(error) return <div className="container account-page"><h1>Connection needs attention</h1><p role="alert">{error}</p><button className="button" onClick={refresh}>Try again</button></div>;
  if(!user) return <Navigate to="/login" replace/>;
  if(role && !user.roles.includes(role)) return <div className="container account-page"><h1>Access restricted</h1><p>This page is available to organizers.</p></div>;
  return <Outlet/>;
}
