/**
 * app/(tabs)/compra-venda.tsx
 *
 * Aba Compra e Venda com 3 sub-abas: Compras, Vendas, Comodato.
 * - Compras: lançamento de notas fiscais + histórico editável
 * - Vendas: registro de vendas (varejo/atacado) com rastreio de vasilhame
 * - Comodato: lançamento de saídas (empréstimo) e entradas (retorno)
 */
import React, {
  useState, useEffect, useCallback, useMemo, useRef, memo,
} from "react"
import {
  View, Text, TouchableOpacity, TextInput, Alert, FlatList,
  StyleSheet, ActivityIndicator, Modal, ScrollView,
  KeyboardAvoidingView, Platform, SectionList,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useAuth } from "@/context/AuthContext"
import { supabase } from "@/lib/supabase"
import { onSync } from "@/lib/syncEvent"
import type {
  Deposito, Produto, Compra, CompraItem, Venda, Comodato, ComodatoItem,
} from "@/lib/types"

const BLUE = "#1e3a5f"
const GRAY = "#94a3b8"

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function hoje() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`
}
function toISO(ddmmyyyy: string) {
  const [d,m,y] = ddmmyyyy.split("/")
  return `${y}-${m}-${d}`
}
function maskDate(t: string) {
  const n = t.replace(/\D/g,"").slice(0,8)
  if (n.length<=2) return n
  if (n.length<=4) return n.slice(0,2)+"/"+n.slice(2)
  return n.slice(0,2)+"/"+n.slice(2,4)+"/"+n.slice(4)
}
function fmtHora(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`
}

// ══════════════════════════════════════════════════════════════════
// Stepper memoizado
// ══════════════════════════════════════════════════════════════════
const Stepper = memo(function Stepper({ value, onChange }: {
  value: number; onChange: (v: number) => void
}) {
  return (
    <View style={st.stepperRow}>
      <TouchableOpacity
        style={[st.stepperBtn, { backgroundColor: "#fee2e2" }]}
        onPress={() => onChange(Math.max(0, value - 1))}
      >
        <Ionicons name="remove" size={18} color="#dc2626" />
      </TouchableOpacity>
      <TextInput
        style={st.stepperInput}
        keyboardType="numeric"
        value={String(value)}
        onChangeText={t => { const v = parseInt(t,10); onChange(isNaN(v)?0:Math.max(0,v)) }}
        selectTextOnFocus
      />
      <TouchableOpacity
        style={[st.stepperBtn, { backgroundColor: "#dcfce7" }]}
        onPress={() => onChange(value + 1)}
      >
        <Ionicons name="add" size={18} color="#16a34a" />
      </TouchableOpacity>
    </View>
  )
})

// ══════════════════════════════════════════════════════════════════
// DepositoPicker (Modal)
// ══════════════════════════════════════════════════════════════════
const DepositoPicker = memo(function DepositoPicker({ depositos, selected, onSelect, label }: {
  depositos: Deposito[]; selected: Deposito|null
  onSelect: (d: Deposito) => void; label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <View style={{ marginBottom: 8 }}>
      {label && <Text style={st.fieldLabel}>{label}</Text>}
      <TouchableOpacity style={st.picker} onPress={() => setOpen(true)}>
        <Text style={selected ? st.pickerText : st.pickerPlaceholder}>
          {selected ? `${selected.nome} (${selected.tipo_deposito === "movel" ? "Móvel" : "Físico"})` : "Selecione o depósito"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={GRAY} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide">
        <View style={st.modalOverlay}>
          <View style={st.modalContent}>
            <Text style={st.modalTitle}>Selecione o Depósito</Text>
            <FlatList
              data={depositos}
              keyExtractor={i => i.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[st.modalItem, selected?.id===item.id && st.modalItemActive]}
                  onPress={() => { onSelect(item); setOpen(false) }}
                >
                  <Text style={[st.modalItemText, selected?.id===item.id && {color:BLUE,fontWeight:"700"}]}>
                    {item.nome} ({item.tipo_deposito === "movel" ? "Móvel" : "Físico"})
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={st.modalClose} onPress={() => setOpen(false)}>
              <Text style={{ color: BLUE, fontWeight: "700" }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
})

// ══════════════════════════════════════════════════════════════════
// ProdutoPicker (Modal para selecionar 1 produto — usado em Vendas)
// ══════════════════════════════════════════════════════════════════
const ProdutoPicker = memo(function ProdutoPicker({ produtos, selected, onSelect }: {
  produtos: Produto[]; selected: Produto|null; onSelect: (p: Produto) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const filtered = useMemo(() => {
    if (!search.trim()) return produtos
    const s = search.toLowerCase()
    return produtos.filter(p => p.nome.toLowerCase().includes(s))
  }, [produtos, search])

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={st.fieldLabel}>Produto</Text>
      <TouchableOpacity style={st.picker} onPress={() => setOpen(true)}>
        <Text style={selected ? st.pickerText : st.pickerPlaceholder}>
          {selected ? selected.nome : "Selecione o produto"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={GRAY} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide">
        <View style={st.modalOverlay}>
          <View style={[st.modalContent, { maxHeight: "70%" }]}>
            <Text style={st.modalTitle}>Selecione o Produto</Text>
            <TextInput
              style={st.searchInput}
              placeholder="Buscar produto..."
              value={search}
              onChangeText={setSearch}
            />
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[st.modalItem, selected?.id===item.id && st.modalItemActive]}
                  onPress={() => { onSelect(item); setOpen(false); setSearch("") }}
                >
                  <Text style={[st.modalItemText, selected?.id===item.id && {color:BLUE,fontWeight:"700"}]}>
                    {item.nome}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={st.modalClose} onPress={() => { setOpen(false); setSearch("") }}>
              <Text style={{ color: BLUE, fontWeight: "700" }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
})

// ══════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════
export default function CompraVendaScreen() {
  const { permissions, user } = useAuth()

  // Sub-aba principal: compras | vendas | comodato
  const [mainTab, setMainTab] = useState<"compras"|"vendas"|"comodato">("vendas")

  // Dados compartilhados
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [loadingBase, setLoadingBase] = useState(true)

  // Carrega depósitos e produtos
  const carregarBase = useCallback(async () => {
    setLoadingBase(true)
    try {
      const [dRes, pRes] = await Promise.all([
        supabase.from("depositos").select("id, nome, tipo_deposito, ativo").eq("ativo", true).order("nome"),
        supabase.from("produtos").select("id, nome, categoria, marca, peso_kg, tipo, tipo_produto, ordem_exibicao, ativo, is_vasilhame").eq("ativo", true).order("ordem_exibicao"),
      ])
      const allDeps = (dRes.data ?? []) as Deposito[]

      // Filtra depósitos por permissão
      const editIds = permissions?.deposito_edit_ids ?? []
      const filteredDeps = permissions?.isAdmin
        ? allDeps
        : editIds.length > 0
          ? allDeps.filter(d => editIds.includes(d.id))
          : allDeps

      setDepositos(filteredDeps)
      setProdutos((pRes.data ?? []) as Produto[])
    } finally {
      setLoadingBase(false)
    }
  }, [permissions])

  useEffect(() => {
    if (!permissions) return
    carregarBase()
  }, [permissions, carregarBase])

  useEffect(() => { return onSync(carregarBase) }, [carregarBase])

  // Depósitos filtrados por tipo
  const depositosMoveis = useMemo(() => depositos.filter(d => d.tipo_deposito === "movel"), [depositos])
  const temDepositoMovel = depositosMoveis.length > 0
  const todosDepositos = depositos // físicos + móveis podem vender e fazer comodato

  // Tabs visíveis: combina permissões granulares + regra de depósito móvel
  const tabsVisiveis = useMemo(() => {
    const tabs: Array<"compras"|"vendas"|"comodato"> = []
    if (temDepositoMovel && permissions?.canCompras) tabs.push("compras")
    if (permissions?.canVendas) tabs.push("vendas")
    if (permissions?.canComodato) tabs.push("comodato")
    return tabs
  }, [temDepositoMovel, permissions])

  // Ajusta mainTab se a aba atual ficou invisível
  useEffect(() => {
    if (tabsVisiveis.length > 0 && !tabsVisiveis.includes(mainTab)) {
      setMainTab(tabsVisiveis[0])
    }
  }, [tabsVisiveis, mainTab])

  if (loadingBase) {
    return (
      <View style={st.center}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={{ color: GRAY, marginTop: 12 }}>Carregando...</Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS==="ios"?"padding":undefined}>
      <View style={st.container}>
        {/* Seletor de sub-aba */}
        {tabsVisiveis.length > 1 && <View style={st.tabRow}>
          {tabsVisiveis.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[st.tabBtn, mainTab===tab && st.tabBtnActive]}
              onPress={() => setMainTab(tab)}
            >
              <Text style={[st.tabBtnText, mainTab===tab && st.tabBtnTextActive]}>
                {tab === "compras" ? "Compras" : tab === "vendas" ? "Vendas" : "Comodato"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>}

        {mainTab === "compras" && (
          <ComprasTab depositos={depositosMoveis} produtos={produtos} userId={user?.id ?? ""} />
        )}
        {mainTab === "vendas" && (
          <VendasTab depositos={depositosMoveis} produtos={produtos} userId={user?.id ?? ""} />
        )}
        {mainTab === "comodato" && (
          <ComodatoTab depositos={todosDepositos} produtos={produtos} userId={user?.id ?? ""} />
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

// ══════════════════════════════════════════════════════════════════
//  SUB-ABA: COMPRAS
// ══════════════════════════════════════════════════════════════════
function ComprasTab({ depositos, produtos, userId }: {
  depositos: Deposito[]; produtos: Produto[]; userId: string
}) {
  const [subTab, setSubTab] = useState<"form"|"historico">("form")
  const [data, setData] = useState(hoje())
  const [deposito, setDeposito] = useState<Deposito|null>(null)
  const [nf, setNf] = useState("")
  const [qtds, setQtds] = useState<Record<string,number>>({})
  const [saving, setSaving] = useState(false)
  const [historico, setHistorico] = useState<Compra[]>([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [editCompra, setEditCompra] = useState<Compra|null>(null)

  const produtosPorCat = useMemo(() => {
    const map: Record<string, Produto[]> = {}
    for (const p of produtos) {
      if (!map[p.categoria]) map[p.categoria] = []
      map[p.categoria].push(p)
    }
    return Object.entries(map).map(([cat, prods]) => ({ title: cat, data: prods }))
  }, [produtos])

  const setQtd = useCallback((pid: string, v: number) => {
    setQtds(prev => ({ ...prev, [pid]: v }))
  }, [])

  const salvar = useCallback(async () => {
    if (!deposito) return Alert.alert("Erro", "Selecione um depósito.")
    if (!nf.trim()) return Alert.alert("Erro", "Informe o número da nota fiscal.")
    const itens = Object.entries(qtds).filter(([,q]) => q > 0).map(([pid,q]) => ({ produto_id: pid, quantidade: q }))
    if (itens.length === 0) return Alert.alert("Erro", "Adicione pelo menos 1 produto.")

    setSaving(true)
    try {
      const { error } = await supabase.rpc("inserir_compra", {
        p_data: toISO(data),
        p_deposito_id: deposito.id,
        p_numero_nota: nf.trim(),
        p_itens: itens,
      })
      if (error) throw error
      Alert.alert("Sucesso", "Compra registrada com sucesso!")
      setQtds({})
      setNf("")
    } catch (e: any) {
      Alert.alert("Erro", e.message)
    } finally {
      setSaving(false)
    }
  }, [deposito, nf, qtds, data])

  const carregarHistorico = useCallback(async () => {
    setLoadingHist(true)
    try {
      const { data: rows, error } = await supabase.rpc("buscar_compras_usuario", {
        p_data_inicio: toISO(data),
        p_data_fim: toISO(data),
        p_user_id: userId,
      })
      if (error) throw error
      setHistorico((rows ?? []) as Compra[])
    } catch (e: any) {
      Alert.alert("Erro", e.message)
    } finally {
      setLoadingHist(false)
    }
  }, [data, userId])

  useEffect(() => {
    if (subTab === "historico") carregarHistorico()
  }, [subTab, carregarHistorico])

  const deletarCompra = useCallback(async (id: string) => {
    Alert.alert("Confirmar", "Deseja excluir esta compra?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: async () => {
        try {
          const { error } = await supabase.rpc("deletar_compra", { p_compra_id: id })
          if (error) throw error
          carregarHistorico()
        } catch (e: any) { Alert.alert("Erro", e.message) }
      }},
    ])
  }, [carregarHistorico])

  return (
    <View style={{ flex: 1 }}>
      {/* Sub-tab toggle */}
      <View style={st.subTabRow}>
        <TouchableOpacity style={[st.subTab, subTab==="form" && st.subTabActive]} onPress={() => setSubTab("form")}>
          <Ionicons name="add-circle-outline" size={16} color={subTab==="form"?BLUE:GRAY} />
          <Text style={[st.subTabText, subTab==="form" && st.subTabTextActive]}>Nova Compra</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.subTab, subTab==="historico" && st.subTabActive]} onPress={() => setSubTab("historico")}>
          <Ionicons name="time-outline" size={16} color={subTab==="historico"?BLUE:GRAY} />
          <Text style={[st.subTabText, subTab==="historico" && st.subTabTextActive]}>Histórico</Text>
        </TouchableOpacity>
      </View>

      {subTab === "form" ? (
        <SectionList
          sections={produtosPorCat}
          keyExtractor={item => item.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={st.formHeader}>
              <Text style={st.fieldLabel}>Data</Text>
              <TextInput style={st.input} value={data} onChangeText={t => setData(maskDate(t))} keyboardType="numeric" maxLength={10} />
              <DepositoPicker depositos={depositos} selected={deposito} onSelect={setDeposito} label="Depósito (Móvel)" />
              {depositos.length === 0 && (
                <View style={st.warningBox}>
                  <Ionicons name="alert-circle" size={18} color="#d97706" />
                  <Text style={st.warningText}>Nenhum depósito móvel disponível para compra.</Text>
                </View>
              )}
              <Text style={st.fieldLabel}>Nº Nota Fiscal *</Text>
              <TextInput style={st.input} value={nf} onChangeText={setNf} placeholder="Ex: 12345" />
              <Text style={[st.sectionTitle, { marginTop: 16 }]}>Produtos</Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={st.catHeader}>
              <Text style={st.catHeaderText}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={st.prodRow}>
              <Text style={st.prodName} numberOfLines={1}>{item.nome}</Text>
              <Stepper value={qtds[item.id] ?? 0} onChange={v => setQtd(item.id, v)} />
            </View>
          )}
          ListFooterComponent={
            <TouchableOpacity
              style={[st.btnPrimary, saving && { opacity: 0.6 }]}
              onPress={salvar} disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="save-outline" size={20} color="#fff" />
                  <Text style={st.btnPrimaryText}>Registrar Compra</Text>
                </>
              )}
            </TouchableOpacity>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      ) : (
        /* HISTÓRICO DE COMPRAS */
        <View style={{ flex: 1 }}>
          <View style={st.formHeader}>
            <Text style={st.fieldLabel}>Data</Text>
            <TextInput style={st.input} value={data} onChangeText={t => setData(maskDate(t))} keyboardType="numeric" maxLength={10} />
            <TouchableOpacity style={st.btnSecondary} onPress={carregarHistorico}>
              <Ionicons name="search" size={18} color={BLUE} />
              <Text style={st.btnSecondaryText}>Buscar</Text>
            </TouchableOpacity>
          </View>
          {loadingHist ? (
            <ActivityIndicator size="large" color={BLUE} style={{ marginTop: 32 }} />
          ) : historico.length === 0 ? (
            <Text style={st.emptyText}>Nenhuma compra encontrada.</Text>
          ) : (
            <FlatList
              data={historico}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingBottom: 32 }}
              renderItem={({ item: c }) => (
                <View style={st.card}>
                  <View style={st.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.cardTitle}>NF: {c.numero_nota}</Text>
                      <Text style={st.cardSub}>{c.deposito_nome} · {fmtHora(c.created_at)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity onPress={() => setEditCompra(c)}>
                        <Ionicons name="create-outline" size={22} color={BLUE} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deletarCompra(c.id)}>
                        <Ionicons name="trash-outline" size={22} color="#dc2626" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {c.itens.map((it, idx) => (
                    <View key={idx} style={st.cardItem}>
                      <Text style={st.cardItemName}>{it.produto_nome}</Text>
                      <Text style={st.cardItemQtd}>{it.quantidade}</Text>
                    </View>
                  ))}
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Modal de edição de compra */}
      {editCompra && (
        <EditCompraModal
          compra={editCompra}
          depositos={depositos}
          produtos={produtos}
          onClose={() => setEditCompra(null)}
          onSaved={() => { setEditCompra(null); carregarHistorico() }}
        />
      )}
    </View>
  )
}

// ══════════════════════════════════════════════════════════════════
//  Modal: Editar Compra
// ══════════════════════════════════════════════════════════════════
function EditCompraModal({ compra, depositos, produtos, onClose, onSaved }: {
  compra: Compra; depositos: Deposito[]; produtos: Produto[]
  onClose: () => void; onSaved: () => void
}) {
  const [dep, setDep] = useState<Deposito|null>(depositos.find(d => d.id === compra.deposito_id) ?? null)
  const [nfVal, setNfVal] = useState(compra.numero_nota)
  const [qtds, setQtds] = useState<Record<string,number>>(() => {
    const m: Record<string,number> = {}
    for (const it of compra.itens) m[it.produto_id] = it.quantidade
    return m
  })
  const [saving, setSaving] = useState(false)

  const salvar = async () => {
    if (!dep) return Alert.alert("Erro", "Selecione depósito.")
    if (!nfVal.trim()) return Alert.alert("Erro", "Informe NF.")
    const itens = Object.entries(qtds).filter(([,q]) => q > 0).map(([pid,q]) => ({ produto_id: pid, quantidade: q }))
    if (itens.length === 0) return Alert.alert("Erro", "Adicione produtos.")
    setSaving(true)
    try {
      const { error } = await supabase.rpc("atualizar_compra", {
        p_compra_id: compra.id,
        p_deposito_id: dep.id,
        p_numero_nota: nfVal.trim(),
        p_itens: itens,
      })
      if (error) throw error
      Alert.alert("Sucesso", "Compra atualizada!")
      onSaved()
    } catch (e: any) { Alert.alert("Erro", e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal visible transparent animationType="slide">
      <View style={st.modalOverlay}>
        <View style={[st.modalContent, { maxHeight: "85%" }]}>
          <Text style={st.modalTitle}>Editar Compra — NF {compra.numero_nota}</Text>
          <ScrollView>
            <DepositoPicker depositos={depositos} selected={dep} onSelect={setDep} label="Depósito" />
            <Text style={st.fieldLabel}>Nº Nota Fiscal</Text>
            <TextInput style={st.input} value={nfVal} onChangeText={setNfVal} />
            <Text style={[st.sectionTitle, { marginTop: 12 }]}>Produtos</Text>
            {produtos.map(p => (
              <View key={p.id} style={st.prodRow}>
                <Text style={st.prodName} numberOfLines={1}>{p.nome}</Text>
                <Stepper value={qtds[p.id] ?? 0} onChange={v => setQtds(prev => ({...prev,[p.id]:v}))} />
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={[st.btnSecondary, { flex: 1 }]} onPress={onClose}>
              <Text style={st.btnSecondaryText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btnPrimary, { flex: 1 }, saving && { opacity: 0.6 }]} onPress={salvar} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <Text style={st.btnPrimaryText}>Salvar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════
//  SUB-ABA: VENDAS
// ══════════════════════════════════════════════════════════════════
function VendasTab({ depositos, produtos, userId }: {
  depositos: Deposito[]; produtos: Produto[]; userId: string
}) {
  const [subTab, setSubTab] = useState<"form"|"historico">("form")
  const [data, setData] = useState(hoje())
  const [deposito, setDeposito] = useState<Deposito|null>(null)
  const [cliente, setCliente] = useState("")
  const [produto, setProduto] = useState<Produto|null>(null)
  const [quantidade, setQuantidade] = useState(0)
  const [tipoVenda, setTipoVenda] = useState<"varejo"|"atacado">("varejo")
  const [vasilhame, setVasilhame] = useState(0)
  const [saving, setSaving] = useState(false)
  const [historico, setHistorico] = useState<Venda[]>([])
  const [loadingHist, setLoadingHist] = useState(false)

  // Vasilhame logic: se quantidade != vasilhame, mostra opção de comodato
  const diferencaVasilhame = quantidade - vasilhame
  const precisaComodato = produto && !produto.is_vasilhame && quantidade > 0 && vasilhame >= 0 && diferencaVasilhame !== 0

  const salvar = useCallback(async () => {
    if (!deposito) return Alert.alert("Erro", "Selecione um depósito.")
    if (!cliente.trim()) return Alert.alert("Erro", "Informe o nome do cliente.")
    if (!produto) return Alert.alert("Erro", "Selecione um produto.")
    if (quantidade <= 0) return Alert.alert("Erro", "Quantidade deve ser maior que 0.")

    setSaving(true)
    try {
      // 1. Registrar a venda
      const { error } = await supabase.rpc("inserir_venda", {
        p_data: toISO(data),
        p_deposito_id: deposito.id,
        p_cliente: cliente.trim(),
        p_produto_id: produto.id,
        p_quantidade: quantidade,
        p_tipo_venda: tipoVenda,
        p_vasilhame_recolhido: vasilhame,
      })
      if (error) throw error

      // 2. Se precisa comodato, perguntar ao usuário
      if (precisaComodato) {
        const tipoComodato = diferencaVasilhame > 0 ? "saida" : "entrada"
        const qtdComodato = Math.abs(diferencaVasilhame)
        const labelTipo = tipoComodato === "saida" ? "Saída (empréstimo)" : "Entrada (retorno)"

        // Encontra o vasilhame vinculado ao produto vendido
        const vasilhames = produtos.filter(p => p.is_vasilhame)
        let vasilhameVinculado = vasilhames.find(v =>
          v.peso_kg != null && produto.peso_kg != null && Number(v.peso_kg) === Number(produto.peso_kg)
        )
        if (!vasilhameVinculado) {
          // Água → Galão de 20L
          const catLower = (produto.categoria ?? "").toLowerCase()
          if (catLower.includes("água") || catLower.includes("agua")) {
            vasilhameVinculado = vasilhames.find(v => v.nome.toLowerCase().includes("galão") || v.nome.toLowerCase().includes("galao"))
          }
        }
        if (!vasilhameVinculado) {
          // Linha doméstica e outros → "Vasilhame Doméstico"
          vasilhameVinculado = vasilhames.find(v => v.nome.toLowerCase().includes("doméstico") || v.nome.toLowerCase().includes("domestico"))
        }
        // Só oferece auto-comodato se encontrou um vasilhame real (nunca usa produto comum)
        if (vasilhameVinculado) {
          Alert.alert(
            "Lançar Comodato?",
            `Diferença de ${qtdComodato} vasilhame(s) detectada.\nProduto: ${vasilhameVinculado.nome}\nTipo: ${labelTipo}\nDeseja lançar o comodato automaticamente?`,
            [
              { text: "Não", style: "cancel" },
              { text: "Sim, Lançar", onPress: async () => {
                try {
                  await supabase.rpc("inserir_comodato", {
                    p_data: toISO(data),
                    p_deposito_id: deposito.id,
                    p_cliente: cliente.trim(),
                    p_tipo: tipoComodato,
                    p_itens: [{ produto_id: vasilhameVinculado!.id, quantidade: qtdComodato }],
                  })
                } catch (e: any) { Alert.alert("Erro no comodato", e.message) }
              }},
            ]
          )
        }
      }

      Alert.alert("Sucesso", "Venda registrada!")
      setCliente("")
      setProduto(null)
      setQuantidade(0)
      setVasilhame(0)
    } catch (e: any) {
      Alert.alert("Erro", e.message)
    } finally {
      setSaving(false)
    }
  }, [deposito, cliente, produto, quantidade, tipoVenda, vasilhame, data, precisaComodato, diferencaVasilhame])

  const carregarHistorico = useCallback(async () => {
    setLoadingHist(true)
    try {
      const { data: rows, error } = await supabase.rpc("buscar_vendas_usuario", {
        p_data_inicio: toISO(data),
        p_data_fim: toISO(data),
        p_user_id: userId,
      })
      if (error) throw error
      setHistorico((rows ?? []) as Venda[])
    } catch (e: any) { Alert.alert("Erro", e.message) }
    finally { setLoadingHist(false) }
  }, [data, userId])

  useEffect(() => {
    if (subTab === "historico") carregarHistorico()
  }, [subTab, carregarHistorico])

  const deletarVenda = useCallback(async (id: string) => {
    Alert.alert("Confirmar", "Deseja excluir esta venda?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: async () => {
        try {
          const { error } = await supabase.rpc("deletar_venda", { p_venda_id: id })
          if (error) throw error
          carregarHistorico()
        } catch (e: any) { Alert.alert("Erro", e.message) }
      }},
    ])
  }, [carregarHistorico])

  return (
    <View style={{ flex: 1 }}>
      <View style={st.subTabRow}>
        <TouchableOpacity style={[st.subTab, subTab==="form" && st.subTabActive]} onPress={() => setSubTab("form")}>
          <Ionicons name="add-circle-outline" size={16} color={subTab==="form"?BLUE:GRAY} />
          <Text style={[st.subTabText, subTab==="form" && st.subTabTextActive]}>Nova Venda</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.subTab, subTab==="historico" && st.subTabActive]} onPress={() => setSubTab("historico")}>
          <Ionicons name="time-outline" size={16} color={subTab==="historico"?BLUE:GRAY} />
          <Text style={[st.subTabText, subTab==="historico" && st.subTabTextActive]}>Histórico</Text>
        </TouchableOpacity>
      </View>

      {subTab === "form" ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={st.formHeader}>
            <Text style={st.fieldLabel}>Data</Text>
            <TextInput style={st.input} value={data} onChangeText={t => setData(maskDate(t))} keyboardType="numeric" maxLength={10} />

            <DepositoPicker depositos={depositos} selected={deposito} onSelect={setDeposito} label="Depósito" />

            <Text style={st.fieldLabel}>Cliente *</Text>
            <TextInput style={st.input} value={cliente} onChangeText={setCliente} placeholder="Nome do cliente" />

            <ProdutoPicker produtos={produtos} selected={produto} onSelect={setProduto} />

            {/* Toggle Varejo / Atacado */}
            <Text style={st.fieldLabel}>Tipo de Venda</Text>
            <View style={st.toggleRow}>
              <TouchableOpacity
                style={[st.toggleBtn, tipoVenda==="varejo" && st.toggleBtnActive]}
                onPress={() => setTipoVenda("varejo")}
              >
                <Text style={[st.toggleText, tipoVenda==="varejo" && st.toggleTextActive]}>Varejo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.toggleBtn, tipoVenda==="atacado" && st.toggleBtnActive]}
                onPress={() => setTipoVenda("atacado")}
              >
                <Text style={[st.toggleText, tipoVenda==="atacado" && st.toggleTextActive]}>Atacado</Text>
              </TouchableOpacity>
            </View>

            <Text style={st.fieldLabel}>Quantidade</Text>
            <Stepper value={quantidade} onChange={setQuantidade} />

            <Text style={[st.fieldLabel, { marginTop: 12 }]}>Vasilhame Recolhido</Text>
            <Stepper value={vasilhame} onChange={setVasilhame} />

            {/* Indicador de comodato */}
            {precisaComodato && (
              <View style={[st.warningBox, { backgroundColor: diferencaVasilhame > 0 ? "#fef3c7" : "#d1fae5" }]}>
                <Ionicons name="swap-vertical" size={18} color={diferencaVasilhame > 0 ? "#d97706" : "#059669"} />
                <Text style={[st.warningText, { color: diferencaVasilhame > 0 ? "#92400e" : "#065f46" }]}>
                  {diferencaVasilhame > 0
                    ? `Comodato Saída: ${diferencaVasilhame} vasilhame(s) a emprestar`
                    : `Comodato Entrada: ${Math.abs(diferencaVasilhame)} vasilhame(s) a retornar`}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[st.btnPrimary, { marginTop: 16 }, saving && { opacity: 0.6 }]}
              onPress={salvar} disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                  <Text style={st.btnPrimaryText}>Registrar Venda</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        /* HISTÓRICO DE VENDAS */
        <View style={{ flex: 1 }}>
          <View style={st.formHeader}>
            <Text style={st.fieldLabel}>Data</Text>
            <TextInput style={st.input} value={data} onChangeText={t => setData(maskDate(t))} keyboardType="numeric" maxLength={10} />
            <TouchableOpacity style={st.btnSecondary} onPress={carregarHistorico}>
              <Ionicons name="search" size={18} color={BLUE} />
              <Text style={st.btnSecondaryText}>Buscar</Text>
            </TouchableOpacity>
          </View>
          {loadingHist ? (
            <ActivityIndicator size="large" color={BLUE} style={{ marginTop: 32 }} />
          ) : historico.length === 0 ? (
            <Text style={st.emptyText}>Nenhuma venda encontrada.</Text>
          ) : (
            <FlatList
              data={historico}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingBottom: 32 }}
              renderItem={({ item: v }) => (
                <View style={st.card}>
                  <View style={st.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.cardTitle}>{v.produto_nome}</Text>
                      <Text style={st.cardSub}>
                        {v.deposito_nome} · {v.cliente_nome} · {fmtHora(v.created_at)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => deletarVenda(v.id)}>
                      <Ionicons name="trash-outline" size={22} color="#dc2626" />
                    </TouchableOpacity>
                  </View>
                  <View style={st.cardItem}>
                    <Text style={st.cardItemName}>Qtd: {v.quantidade} · {v.tipo_venda === "varejo" ? "Varejo" : "Atacado"}</Text>
                    <Text style={st.cardItemQtd}>Vasil: {v.vasilhame_recolhido}</Text>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      )}
    </View>
  )
}

// ══════════════════════════════════════════════════════════════════
//  SUB-ABA: COMODATO
// ══════════════════════════════════════════════════════════════════
function ComodatoTab({ depositos, produtos, userId }: {
  depositos: Deposito[]; produtos: Produto[]; userId: string
}) {
  const [subTab, setSubTab] = useState<"form"|"historico">("form")
  const [data, setData] = useState(hoje())
  const [deposito, setDeposito] = useState<Deposito|null>(null)
  const [cliente, setCliente] = useState("")
  const [tipoComodato, setTipoComodato] = useState<"saida"|"entrada">("saida")
  const [qtds, setQtds] = useState<Record<string,number>>({})
  const [saving, setSaving] = useState(false)
  const [historico, setHistorico] = useState<Comodato[]>([])
  const [loadingHist, setLoadingHist] = useState(false)

  // Comodato: mostrar APENAS vasilhames (não produtos comuns)
  const produtosPorCat = useMemo(() => {
    const map: Record<string, Produto[]> = {}
    for (const p of produtos) {
      if (!p.is_vasilhame) continue // só vasilhames no comodato
      if (!map[p.categoria]) map[p.categoria] = []
      map[p.categoria].push(p)
    }
    return Object.entries(map).map(([cat, prods]) => ({ title: cat, data: prods }))
  }, [produtos])

  const setQtd = useCallback((pid: string, v: number) => {
    setQtds(prev => ({ ...prev, [pid]: v }))
  }, [])

  const salvar = useCallback(async () => {
    if (!deposito) return Alert.alert("Erro", "Selecione um depósito.")
    if (!cliente.trim()) return Alert.alert("Erro", "Informe o nome do cliente.")
    const itens = Object.entries(qtds).filter(([,q]) => q > 0).map(([pid,q]) => ({ produto_id: pid, quantidade: q }))
    if (itens.length === 0) return Alert.alert("Erro", "Adicione pelo menos 1 vasilhame.")

    setSaving(true)
    try {
      const { error } = await supabase.rpc("inserir_comodato", {
        p_data: toISO(data),
        p_deposito_id: deposito.id,
        p_cliente: cliente.trim(),
        p_tipo: tipoComodato,
        p_itens: itens,
      })
      if (error) throw error
      const label = tipoComodato === "saida" ? "Comodato (saída)" : "Retorno (entrada)"
      Alert.alert("Sucesso", `${label} registrado!`)
      setQtds({})
      setCliente("")
    } catch (e: any) {
      Alert.alert("Erro", e.message)
    } finally {
      setSaving(false)
    }
  }, [deposito, cliente, tipoComodato, qtds, data])

  const carregarHistorico = useCallback(async () => {
    setLoadingHist(true)
    try {
      const { data: rows, error } = await supabase.rpc("buscar_comodatos_usuario", {
        p_data_inicio: toISO(data),
        p_data_fim: toISO(data),
        p_user_id: userId,
      })
      if (error) throw error
      setHistorico((rows ?? []) as Comodato[])
    } catch (e: any) { Alert.alert("Erro", e.message) }
    finally { setLoadingHist(false) }
  }, [data, userId])

  useEffect(() => {
    if (subTab === "historico") carregarHistorico()
  }, [subTab, carregarHistorico])

  const deletarComodato = useCallback(async (id: string) => {
    Alert.alert("Confirmar", "Deseja excluir este comodato?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: async () => {
        try {
          const { error } = await supabase.rpc("deletar_comodato", { p_comodato_id: id })
          if (error) throw error
          carregarHistorico()
        } catch (e: any) { Alert.alert("Erro", e.message) }
      }},
    ])
  }, [carregarHistorico])

  return (
    <View style={{ flex: 1 }}>
      <View style={st.subTabRow}>
        <TouchableOpacity style={[st.subTab, subTab==="form" && st.subTabActive]} onPress={() => setSubTab("form")}>
          <Ionicons name="add-circle-outline" size={16} color={subTab==="form"?BLUE:GRAY} />
          <Text style={[st.subTabText, subTab==="form" && st.subTabTextActive]}>Novo Comodato</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.subTab, subTab==="historico" && st.subTabActive]} onPress={() => setSubTab("historico")}>
          <Ionicons name="time-outline" size={16} color={subTab==="historico"?BLUE:GRAY} />
          <Text style={[st.subTabText, subTab==="historico" && st.subTabTextActive]}>Histórico</Text>
        </TouchableOpacity>
      </View>

      {subTab === "form" ? (
        <SectionList
          sections={produtosPorCat}
          keyExtractor={item => item.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={st.formHeader}>
              <Text style={st.fieldLabel}>Data</Text>
              <TextInput style={st.input} value={data} onChangeText={t => setData(maskDate(t))} keyboardType="numeric" maxLength={10} />
              <DepositoPicker depositos={depositos} selected={deposito} onSelect={setDeposito} label="Depósito" />

              <Text style={st.fieldLabel}>Cliente *</Text>
              <TextInput style={st.input} value={cliente} onChangeText={setCliente} placeholder="Nome do cliente" />

              {/* Toggle Saída / Entrada */}
              <Text style={st.fieldLabel}>Tipo</Text>
              <View style={st.toggleRow}>
                <TouchableOpacity
                  style={[st.toggleBtn, tipoComodato==="saida" && { backgroundColor: "#fef3c7", borderColor: "#d97706" }]}
                  onPress={() => setTipoComodato("saida")}
                >
                  <Ionicons name="arrow-up-circle-outline" size={16} color={tipoComodato==="saida"?"#d97706":GRAY} />
                  <Text style={[st.toggleText, tipoComodato==="saida" && { color: "#92400e", fontWeight: "700" }]}>
                    Saída (Empréstimo)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.toggleBtn, tipoComodato==="entrada" && { backgroundColor: "#d1fae5", borderColor: "#059669" }]}
                  onPress={() => setTipoComodato("entrada")}
                >
                  <Ionicons name="arrow-down-circle-outline" size={16} color={tipoComodato==="entrada"?"#059669":GRAY} />
                  <Text style={[st.toggleText, tipoComodato==="entrada" && { color: "#065f46", fontWeight: "700" }]}>
                    Entrada (Retorno)
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[st.sectionTitle, { marginTop: 16 }]}>Produtos</Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={st.catHeader}>
              <Text style={st.catHeaderText}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={st.prodRow}>
              <Text style={st.prodName} numberOfLines={1}>{item.nome}</Text>
              <Stepper value={qtds[item.id] ?? 0} onChange={v => setQtd(item.id, v)} />
            </View>
          )}
          ListFooterComponent={
            <TouchableOpacity
              style={[st.btnPrimary, saving && { opacity: 0.6 },
                tipoComodato === "saida" ? { backgroundColor: "#d97706" } : { backgroundColor: "#059669" }]}
              onPress={salvar} disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name={tipoComodato==="saida"?"arrow-up-circle":"arrow-down-circle"} size={20} color="#fff" />
                  <Text style={st.btnPrimaryText}>
                    {tipoComodato === "saida" ? "Registrar Comodato (Saída)" : "Registrar Retorno (Entrada)"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      ) : (
        /* HISTÓRICO DE COMODATOS */
        <View style={{ flex: 1 }}>
          <View style={st.formHeader}>
            <Text style={st.fieldLabel}>Data</Text>
            <TextInput style={st.input} value={data} onChangeText={t => setData(maskDate(t))} keyboardType="numeric" maxLength={10} />
            <TouchableOpacity style={st.btnSecondary} onPress={carregarHistorico}>
              <Ionicons name="search" size={18} color={BLUE} />
              <Text style={st.btnSecondaryText}>Buscar</Text>
            </TouchableOpacity>
          </View>
          {loadingHist ? (
            <ActivityIndicator size="large" color={BLUE} style={{ marginTop: 32 }} />
          ) : historico.length === 0 ? (
            <Text style={st.emptyText}>Nenhum comodato encontrado.</Text>
          ) : (
            <FlatList
              data={historico}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingBottom: 32 }}
              renderItem={({ item: c }) => (
                <View style={[st.card, c.tipo === "saida"
                  ? { borderLeftColor: "#d97706", borderLeftWidth: 4 }
                  : { borderLeftColor: "#059669", borderLeftWidth: 4 }]}>
                  <View style={st.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={[st.badge, c.tipo === "saida"
                          ? { backgroundColor: "#fef3c7" } : { backgroundColor: "#d1fae5" }]}>
                          <Text style={[st.badgeText, c.tipo === "saida"
                            ? { color: "#92400e" } : { color: "#065f46" }]}>
                            {c.tipo === "saida" ? "SAÍDA" : "ENTRADA"}
                          </Text>
                        </View>
                        <Text style={st.cardTitle}>{c.cliente_nome}</Text>
                      </View>
                      <Text style={st.cardSub}>{c.deposito_nome} · {fmtHora(c.created_at)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => deletarComodato(c.id)}>
                      <Ionicons name="trash-outline" size={22} color="#dc2626" />
                    </TouchableOpacity>
                  </View>
                  {c.itens.map((it, idx) => (
                    <View key={idx} style={st.cardItem}>
                      <Text style={st.cardItemName}>{it.produto_nome}</Text>
                      <Text style={st.cardItemQtd}>{it.quantidade}</Text>
                    </View>
                  ))}
                </View>
              )}
            />
          )}
        </View>
      )}
    </View>
  )
}

// ══════════════════════════════════════════════════════════════════
//  ESTILOS
// ══════════════════════════════════════════════════════════════════
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" },

  // Tabs principais
  tabRow: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabBtnActive: { borderBottomWidth: 3, borderBottomColor: BLUE },
  tabBtnText: { fontSize: 14, fontWeight: "600", color: GRAY },
  tabBtnTextActive: { color: BLUE },

  // Sub-tabs
  subTabRow: { flexDirection: "row", backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  subTab: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "#f1f5f9" },
  subTabActive: { backgroundColor: "#dbeafe" },
  subTabText: { fontSize: 13, color: GRAY, fontWeight: "600" },
  subTabTextActive: { color: BLUE },

  // Form
  formHeader: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#475569", marginBottom: 4, marginTop: 8 },
  input: { height: 44, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, backgroundColor: "#fff", fontSize: 15 },
  searchInput: { height: 40, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 10, fontSize: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: BLUE },

  // Picker
  picker: { height: 44, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerText: { fontSize: 15, color: "#1e293b" },
  pickerPlaceholder: { fontSize: 15, color: GRAY },

  // Toggle
  toggleRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  toggleBtn: { flex: 1, height: 40, borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 10, justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 4 },
  toggleBtnActive: { backgroundColor: "#dbeafe", borderColor: BLUE },
  toggleText: { fontSize: 13, fontWeight: "600", color: GRAY },
  toggleTextActive: { color: BLUE },

  // Stepper
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepperBtn: { width: 32, height: 32, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  stepperInput: { width: 48, height: 32, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, textAlign: "center", fontSize: 15, backgroundColor: "#fff" },

  // Produto row
  prodRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  prodName: { flex: 1, fontSize: 14, color: "#1e293b", marginRight: 8 },

  // Categoria
  catHeader: { backgroundColor: "#f1f5f9", paddingHorizontal: 16, paddingVertical: 6 },
  catHeaderText: { fontSize: 13, fontWeight: "700", color: "#64748b" },

  // Warning
  warningBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: "#fef3c7", borderRadius: 10, marginTop: 8 },
  warningText: { flex: 1, fontSize: 13, color: "#92400e" },

  // Buttons
  btnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, backgroundColor: BLUE, borderRadius: 12, marginHorizontal: 16, marginTop: 16 },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  btnSecondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderWidth: 1.5, borderColor: BLUE, borderRadius: 10, marginTop: 8 },
  btnSecondaryText: { color: BLUE, fontSize: 14, fontWeight: "600" },

  // Cards
  card: { backgroundColor: "#fff", borderRadius: 12, marginHorizontal: 16, marginTop: 12, padding: 14, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  cardSub: { fontSize: 12, color: GRAY, marginTop: 2 },
  cardItem: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  cardItemName: { fontSize: 13, color: "#475569" },
  cardItemQtd: { fontSize: 14, fontWeight: "700", color: BLUE },

  // Badge
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "800" },

  // Empty
  emptyText: { textAlign: "center", color: GRAY, marginTop: 32, fontSize: 15 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "60%" },
  modalTitle: { fontSize: 17, fontWeight: "700", color: BLUE, marginBottom: 12 },
  modalItem: { paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  modalItemActive: { backgroundColor: "#dbeafe" },
  modalItemText: { fontSize: 15, color: "#1e293b" },
  modalClose: { alignItems: "center", paddingVertical: 14, marginTop: 8, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
})
