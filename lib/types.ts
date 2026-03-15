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
  tipo_deposito: "fisico" | "movel"
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

// ─── Compra (nota fiscal) ────────────────────────────────────────────
export interface CompraItem {
  id?: string
  produto_id: string
  produto_nome?: string
  quantidade: number
}
export interface Compra {
  id: string
  data_referencia: string
  deposito_id: string
  deposito_nome?: string
  numero_nota: string
  created_by: string
  created_at: string
  itens: CompraItem[]
}

// ─── Venda ───────────────────────────────────────────────────────────
export interface Venda {
  id: string
  data_referencia: string
  deposito_id: string
  deposito_nome?: string
  cliente_nome: string
  produto_id: string
  produto_nome?: string
  quantidade: number
  tipo_venda: "varejo" | "atacado"
  vasilhame_recolhido: number
  created_by: string
  created_at: string
}

// ─── Comodato ────────────────────────────────────────────────────────
export interface ComodatoItem {
  id?: string
  produto_id: string
  produto_nome?: string
  quantidade: number
}
export interface Comodato {
  id: string
  data_referencia: string
  deposito_id: string
  deposito_nome?: string
  cliente_nome: string
  tipo: "saida" | "entrada"
  created_by: string
  created_at: string
  itens: ComodatoItem[]
}

// ─── Permissões do usuário ─────────────────────────────────────────
export interface UserPermissions {
  role: AppRole
  isAdmin: boolean              // administrador (acesso total)
  // Abas principais
  canHome: boolean              // pode ver aba Início
  canAbastecimento: boolean     // pode ver aba Abastecimento
  canContagem: boolean          // pode ver aba Contagem
  canCompraVenda: boolean       // pode ver aba Compra e Venda
  // Sub-abas Abastecimento
  canAbastLancamento: boolean   // pode usar sub-aba Lançamento
  canAbastHistorico: boolean    // pode usar sub-aba Histórico
  // Sub-abas Compra e Venda
  canCompras: boolean           // pode usar sub-aba Compras
  canVendas: boolean            // pode usar sub-aba Vendas
  canComodato: boolean          // pode usar sub-aba Comodato
  // Permissões granulares da tabela user_permissions
  deposito_ids: string[]        // vazio = sem restrição de visualização
  deposito_edit_ids: string[]   // depósitos com permissão de edição
  modulos: string[]             // módulos habilitados via role_permissions
}
