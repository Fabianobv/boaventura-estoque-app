/**
 * context/AuthContext.tsx
 *
 * Contexto global de autenticação.
 * Lê a role do usuário via JWT Custom Claims (campo user_role)
 * e carrega os módulos de role_permissions + permissões granulares de user_permissions.
 *
 * O acesso é determinado pelos MÓDULOS habilitados em role_permissions,
 * não pelo nome do role. Administrador sempre tem acesso total.
 */
import React, {
  createContext, useContext, useEffect, useState, useCallback, useMemo,
} from "react"
import { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import type { AppRole, UserPermissions } from "@/lib/types"

// ─── Interfaces do contexto ────────────────────────────────────────
interface AuthContextValue {
  session:     Session | null
  user:        User    | null
  permissions: UserPermissions | null
  loading:     boolean
  signIn:  (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Extrai a role do JWT (custom claim injetado pelo Auth Hook do Supabase) */
function getRoleFromSession(session: Session | null): AppRole {
  if (!session) return "visualizador"
  try {
    const payload = JSON.parse(
      atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    )
    const role = payload.user_role as AppRole | undefined
    return role ?? "visualizador"
  } catch {
    return "visualizador"
  }
}

function buildPermissions(
  role: AppRole,
  modulos: string[],
  deposito_ids: string[],
  deposito_edit_ids: string[],
): UserPermissions {
  const isAdmin = role === "administrador"

  // Admin ignora restrições — acesso total
  const effectiveModulos    = isAdmin ? [] : modulos
  const effectiveDepositos  = isAdmin ? [] : deposito_ids
  const effectiveEditIds    = isAdmin ? [] : deposito_edit_ids

  // canAbastecimento: admin OU módulo app_abastecimento habilitado
  const canAbastecimento = isAdmin
    || effectiveModulos.includes("app_abastecimento")

  // canContagem: admin OU módulo app_contagem habilitado
  const canContagem = isAdmin
    || effectiveModulos.includes("app_contagem")

  return {
    role,
    isAdmin,
    canAbastecimento,
    canContagem,
    deposito_ids: effectiveDepositos,
    deposito_edit_ids: effectiveEditIds,
    modulos: effectiveModulos,
  }
}

// ─── Contexto ──────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session,     setSession]     = useState<Session | null>(null)
  const [user,        setUser]        = useState<User    | null>(null)
  const [permissions, setPermissions] = useState<UserPermissions | null>(null)
  const [loading,     setLoading]     = useState(true)

  /** Carrega módulos do role + permissões granulares do user */
  const loadPermissions = useCallback(async (s: Session, role: AppRole) => {
    try {
      // 1. Carregar módulos do role via role_permissions
      const { data: roleData } = await supabase
        .from("role_permissions")
        .select("modulos")
        .eq("role", role)
        .maybeSingle()
      const modulos: string[] = roleData?.modulos ?? []

      // 2. Carregar permissões granulares do usuário
      const { data: userData } = await supabase
        .from("user_permissions")
        .select("deposito_ids, deposito_edit_ids")
        .eq("user_id", s.user.id)
        .maybeSingle()
      const deposito_ids: string[]      = userData?.deposito_ids      ?? []
      const deposito_edit_ids: string[] = userData?.deposito_edit_ids ?? []

      setPermissions(buildPermissions(role, modulos, deposito_ids, deposito_edit_ids))
    } catch {
      // Em caso de falha, usa apenas a role sem restrições adicionais
      setPermissions(buildPermissions(role, [], [], []))
    }
  }, [])

  const applySession = useCallback(async (s: Session | null) => {
    setSession(s)
    setUser(s?.user ?? null)
    if (s) {
      const role = getRoleFromSession(s)
      await loadPermissions(s, role)
    } else {
      setPermissions(null)
    }
  }, [loadPermissions])

  useEffect(() => {
    // Carrega sessão persistida (SecureStore)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      await applySession(session)
      setLoading(false)
    })

    // Escuta mudanças de estado de autenticação em tempo real
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        await applySession(session)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [applySession])

  const signIn = useCallback(async (
    email: string, password: string
  ): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  // Memoize o context value para evitar re-renders desnecessários dos consumers
  const contextValue = useMemo(() => ({
    session, user, permissions, loading, signIn, signOut,
  }), [session, user, permissions, loading, signIn, signOut])

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook de consumo ───────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>")
  return ctx
}
