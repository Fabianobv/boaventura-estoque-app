/**
 * lib/types.ts — Tipos compartilhados do app
 */

// ─── Roles (espelha os JWT custom claims do sistema web) ───────────
export type AppRole = "administrador" | "operador" | "visualizador"

// ─── Perfil do usuário ─────────────────────────────────────────────
export interface UserProfile {
  id: string
  nome_completo: string
  role: "administrador" | "gerente" | "usuario"  // tabela profiles
  ativo: boolean
}

// ─── Depósito ──────────────────────────────────────────────────────
export interface Deposito {
  id: string
  nome: string
  localizacao: string | null
  ativo: boolean
}

// ─── Produto ───────────────────────────────────────────────────────
export interface Produto {
  id: string
  nome: string
  categoria: string
  marca: "Fogás" | "Amazongás" | "N/A"
  peso_kg: number | null
  tipo: "Cheio" | "Vazio" | "N/A"
  ordem_exibicao: number
  ativo: boolean
  is_vasilhame: boolean
}

// ─── Linha de estoque do dia ────────────────────────────────────────
export interface EstoqueLinha {
  id: string
  data_referencia: string   // "YYYY-MM-DD"
  deposito_id: string
  produto_id: string
  saldo_inicial: number
  abastecimento: number
  retirada: number
  comprados: number
  vendidos_varejo: number
  vendidos_atacado: number
  consumido: number
  obs_consumido: string | null
  roubado_extraviado: number
  obs_roubado: string | null
  contagem_final: number
  avariado: number
  // campos calculados pela view
  saldo_do_dia?: number
  diferenca?: number
  produto_nome?: string
  produto_categoria?: string
  deposito_nome?: string
}

// ─── Lançamento de abastecimento/retirada ──────────────────────────
export interface LancamentoInput {
  data_referencia: string
  deposito_id: string
  produto_id: string
  abastecimento: number
  retirada: number
}

// ─── Contagem de estoque ───────────────────────────────────────────
export interface ContagemInput {
  data_referencia: string
  deposito_id: string
  produto_id: string
  contagem_final: number
  avariado: number
}

// ─── Permissões derivadas do JWT ───────────────────────────────────
export interface UserPermissions {
  role: AppRole
  isGerente: boolean   // operador ou administrador
  isAdmin: boolean     // apenas administrador
  canAbastecimento: boolean
  canContagem: boolean
}
