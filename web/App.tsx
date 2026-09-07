import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { can } from "./api";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPages";
import { Button, Card } from "./components/ui";
import { appRoutes } from "../modules/frontend-registry";

export function App() {
  const { principal } = useAuth();
  const [path, setPath] = useState(location.hash.slice(1));

  useEffect(() => {
    const onHashChange = () => setPath(location.hash.slice(1));
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, []);

  const defaultPath = can(principal, "accounts:read") ? "accounts" : can(principal, "school:read") ? "school" : "system-status";
  const activePath = path || defaultPath;

  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [activePath]);
  if (!principal) return <AuthPage/>;

  const route = appRoutes[activePath] || appRoutes[defaultPath] || appRoutes["system-status"];
  if (!route) return <div className="page"><Card><div className="empty"><h3>No application route is available</h3><p>Check the module registry and rebuild the frontend.</p></div></Card></div>;
  const View = route.view;
  const allowed = (!route.scope || can(principal, route.scope)) && (!route.admin || ["owner", "admin"].includes(principal.role));

  return <AppShell active={activePath} onNavigate={next => { location.hash = next; }}>
    {allowed ? <View key={activePath}/> : <PermissionDenied fallback={defaultPath}/>} 
  </AppShell>;
}

function PermissionDenied({ fallback }: { fallback: string }) {
  return <div className="page"><Card><div className="empty"><h3>Permission denied</h3><p>Your role or assigned scopes do not allow access to this page. Ask an organization owner or administrator if you need access.</p><Button onClick={() => location.hash = fallback}>Return to your workspace</Button></div></Card></div>;
}
