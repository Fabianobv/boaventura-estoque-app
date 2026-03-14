/**
 * lib/types.ts — Tipos compartilhados do app
 */

// ─── Roles (espelha profiles.role no banco) ─────────────────────
export type AppRole =
  | "administrador"
  | "gerente"
  | "operador"
  | "motorista"
  | "entregador"
  | "visualizador"

// ─── Perfil do usuário ─────────────────────────────────────────────
export interface UserProfile {
  id: string
  nome_completo: string
  role: AppRole
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
  marca: string         // dinâmico — tabela marcas
  peso_kg: number | null
  tipo: string          // "Cheio" | "Vazio" | "N/A" etc.
  tipo_produto: "comum" | "vasilhame"
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
  validated_by: string | null
  validated_at: string | null
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

// ─── Permissões do usuário ─────────────────────────────────────────
export interface UserPermissions {
  role: AppRole
  isAdmin: boolean           // administrador (acesso total)
  canAbastecimento: boolean  // pode usar aba Abastecimento
  canContagem: boolean       // pode usar aba Contagem
  // Permissões granulares da tabela user_permissions
  deposito_ids: string[]      // vazio = sem restrição de visualização
  deposito_edit_ids: string[] // depósitos com permissão de edição
  modulos: string[]           // módulos habilitados via role_permissions
}
