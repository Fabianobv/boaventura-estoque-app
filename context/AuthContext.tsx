/**
 * context/AuthContext.tsx
 *
 * Contexto global de autenticação.
 * Lê a role do usuário via JWT Custom Claims (campo user_role)
 * e carrega as permissões granulares da tabela user_permissions.
 */
import React, {
  createContext, useContext, useEffect, useState, useCallback,
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

function buildBasePermissions(
  role: AppRole,
  deposito_ids: string[],
  deposito_edit_ids: string[],
  modulos: string[]
): UserPermissions {
  const isAdmin   = role === "administrador"
  const isGerente = role === "administrador" || role === "operador"

  // Se admin, ignora restrições de módulos e depósitos
  const effectiveModulos    = isAdmin ? [] : modulos
  const effectiveDepositos  = isAdmin ? [] : deposito_ids
  // Admin: [] = todos os depósitos têm edição (interpretado junto com isAdmin nos componentes)
  const effectiveEditIds    = isAdmin ? [] : deposito_edit_ids

  // canAbastecimento: sem restrição de módulo OU módulo app_abastecimento presente
  const canAbastecimento = effectiveModulos.length === 0
    || effectiveModulos.includes("app_abastecimento")

  // canContagem: requer pelo menos operador E (sem restrição OU módulo app_contagem)
  const canContagem = isGerente
    && (effectiveModulos.length === 0 || effectiveModulos.includes("app_contagem"))

  return {
    role,
    isGerente,
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

  /** Carrega permissões granulares da tabela user_permissions */
  const loadPermissions = useCallback(async (s: Session, role: AppRole) => {
    try {
      const { data } = await supabase
        .from("user_permissions")
        .select("deposito_ids, deposito_edit_ids, modulos")
        .eq("user_id", s.user.id)
        .maybeSingle()
      const deposito_ids: string[]      = data?.deposito_ids      ?? []
      const deposito_edit_ids: string[] = data?.deposito_edit_ids ?? []
      const modulos: string[]           = data?.modulos           ?? []
      setPermissions(buildBasePermissions(role, deposito_ids, deposito_edit_ids, modulos))
    } catch {
      // Em caso de falha, usa apenas a role sem restrições adicionais
      setPermissions(buildBasePermissions(role, [], [], []))
    }
  }, [])

  const applySession = useCallback(async (s: Session | null) => {
    setSession(s)
    setUser(s?.user ?? null)
    if (s) {
      const role = getRoleFromSession(s)
      // Carrega permissões granulares do banco
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

  return (
    <AuthContext.Provider value={{ session, user, permissions, loading, signIn, signOut }}>
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
