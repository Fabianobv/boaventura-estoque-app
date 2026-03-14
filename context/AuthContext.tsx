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
  createContext, useContext, useEffect, useState, useCallback, useMemo, useRef,
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

/** Executa uma promise com timeout. Rejeita se exceder o limite. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ])
}

// ─── Contexto ──────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session,     setSession]     = useState<Session | null>(null)
  const [user,        setUser]        = useState<User    | null>(null)
  const [permissions, setPermissions] = useState<UserPermissions | null>(null)
  const [loading,     setLoading]     = useState(true)
  const processingRef = useRef(false)

  /** Carrega módulos do role + permissões granulares do user (com timeout de 8s) */
  const loadPermissions = useCallback(async (s: Session, role: AppRole) => {
    try {
      const result = await withTimeout(
        Promise.all([
          supabase
            .from("role_permissions")
            .select("modulos")
            .eq("role", role)
            .maybeSingle(),
          supabase
            .from("user_permissions")
            .select("deposito_ids, deposito_edit_ids")
            .eq("user_id", s.user.id)
            .maybeSingle(),
        ]),
        8000
      )

      const [roleRes, userRes] = result
      const modulos: string[]          = roleRes.data?.modulos          ?? []
      const deposito_ids: string[]     = userRes.data?.deposito_ids     ?? []
      const deposito_edit_ids: string[] = userRes.data?.deposito_edit_ids ?? []

      setPermissions(buildPermissions(role, modulos, deposito_ids, deposito_edit_ids))
    } catch {
      // Em caso de falha ou timeout, usa apenas a role sem restrições adicionais
      setPermissions(buildPermissions(role, [], [], []))
    }
  }, [])

  const applySession = useCallback(async (s: Session | null) => {
    // Evita chamadas concorrentes (race condition getSession vs onAuthStateChange)
    if (processingRef.current) return
    processingRef.current = true
    try {
      setSession(s)
      setUser(s?.user ?? null)
      if (s) {
        const role = getRoleFromSession(s)
        await loadPermissions(s, role)
      } else {
        setPermissions(null)
      }
    } finally {
      processingRef.current = false
      setLoading(false)
    }
  }, [loadPermissions])

  useEffect(() => {
    // Usa APENAS onAuthStateChange para gerenciar sessão.
    // Supabase v2 dispara INITIAL_SESSION automaticamente, eliminando
    // a necessidade de chamar getSession() separadamente e evitando race conditions.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        await applySession(session)
      }
    )

    // Fallback: se onAuthStateChange não disparar em 5s, desbloqueia o loading
    const fallbackTimer = setTimeout(() => {
      if (loading) {
        console.warn("AuthContext: fallback timer - forcing loading=false")
        setLoading(false)
      }
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(fallbackTimer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
