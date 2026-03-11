/**
 * app/(tabs)/abastecimento.tsx — Lançamento e Histórico de Movimentos
 *
 * Aba 1 – Lançamento:
 *   • Seleciona data (dd/mm/aaaa), depósito (dropdown), tipo (Abastec./Retirada)
 *   • Lista todos os produtos agrupados por categoria (ordem da tabela categorias)
 *   • Campo de quantidade por produto; salva todos de uma vez no final
 *
 * Aba 2 – Histórico:
 *   • Movimentos do usuário logado em ordem decrescente
 *   • Filtros: data e depósito
 *   • Editar quantidade, depósito e observação
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, Modal, FlatList,
  KeyboardAvoidingView, Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { format, parse, isValid } from "date-fns"
import { ptBR } from "date-fns/locale"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import type { Deposito, Produto } from "@/lib/types"

// ─── Helpers de data ──────────────────────────────────────────────
function toISO(ddmmaaaa: string): string {
  const d = parse(ddmmaaaa, "dd/MM/yyyy", new Date())
  return isValid(d) ? format(d, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd")
}
function toPT(isoDate: string): string {
  const d = parse(isoDate, "yyyy-MM-dd", new Date())
  return isValid(d) ? format(d, "dd/MM/yyyy") : isoDate
}
function hojeISO() { return format(new Date(), "yyyy-MM-dd") }
function hojePT()  { return format(new Date(), "dd/MM/yyyy") }

// ─── Tipos locais ─────────────────────────────────────────────────
type Tipo = "abastecimento" | "retirada"

interface ProdutoComQtd extends Produto {
  qtd: string
  categoria_ordem: number
}

interface MovimentoHistorico {
  id: string
  data_referencia: string   // ISO
  deposito_id: string
  deposito_nome: string
  produto_id: string
  produto_nome: string
  produto_categ: string
  tipo: Tipo
  quantidade: number
  obs: string | null
  created_at: string
}

// ─── Componente: Picker de Depósito ───────────────────────────────
function DepositoPicker({
  depositos, value, onChange, disabled,
}: {
  depositos: Deposito[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selecionado = depositos.find(d => d.id === value)

  return (
    <>
      <TouchableOpacity
        onPress={() => !disabled && setOpen(true)}
        style={[styles.picker, disabled && { opacity: 0.5 }]}
        activeOpacity={0.7}>
        <Text style={selecionado ? styles.pickerText : styles.pickerPlaceholder}>
          {selecionado ? selecionado.nome : "Selecione o depósito..."}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#64748b" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={styles.pickerModal}>
            <Text style={styles.pickerModalTitle}>Selecione o Depósito</Text>
            <FlatList
              data={depositos}
              keyExtractor={d => d.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pickerItem, item.id === value && styles.pickerItemActive]}
                  onPress={() => { onChange(item.id); setOpen(false) }}>
                  <Text style={[styles.pickerItemText, item.id === value && styles.pickerItemTextActive]}>
                    {item.nome}
                  </Text>
                  {item.id === value && <Ionicons name="checkmark" size={18} color="#fff" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

// ─── Tela principal ───────────────────────────────────────────────
export default function AbastecimentoScreen() {
  const { user } = useAuth()
  const [abaAtiva, setAbaAtiva] = useState<"lancamento" | "historico">("lancamento")

  // ── Estado: Lançamento ────────────────────────────────────────
  const [dataLanc,    setDataLanc]    = useState(hojePT())
  const [depositoId,  setDepositoId]  = useState("")
  const [tipo,        setTipo]        = useState<Tipo>("abastecimento")
  const [produtos,    setProdutos]    = useState<ProdutoComQtd[]>([])
  const [depositos,   setDepositos]   = useState<Deposito[]>([])
  const [loadingLanc, setLoadingLanc] = useState(false)
  const [saving,      setSaving]      = useState(false)

  // ── Estado: Histórico ─────────────────────────────────────────
  const [dataHistIni,  setDataHistIni]  = useState(hojePT())
  const [dataHistFim,  setDataHistFim]  = useState(hojePT())
  const [depositoHist, setDepositoHist] = useState("")
  const [historico,    setHistorico]    = useState<MovimentoHistorico[]>([])
  const [loadingHist,  setLoadingHist]  = useState(false)
  const [refreshingH,  setRefreshingH]  = useState(false)

  // ── Estado: Modal edição ──────────────────────────────────────
  const [editMov,       setEditMov]       = useState<MovimentoHistorico | null>(null)
  const [editQtd,       setEditQtd]       = useState("")
  const [editObs,       setEditObs]       = useState("")
  const [editDeposito,  setEditDeposito]  = useState("")
  const [editSaving,    setEditSaving]    = useState(false)

  // ── Carregamento de depósitos e produtos ─────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("depositos").select("id, nome, localizacao, ativo").eq("ativo", true).order("nome"),
      supabase.from("produtos")
        .select("id, nome, categoria, marca, is_vasilhame, ordem_exibicao, ativo")
        .eq("ativo", true)
        .eq("is_vasilhame", false)
        .order("ordem_exibicao"),
    ]).then(([deps, prods]) => {
      if (deps.data) {
        setDepositos(deps.data as Deposito[])
        if (deps.data.length > 0) setDepositoId(deps.data[0].id)
      }
      if (prods.data) {
        // Busca a ordem da categoria para cada produto
        supabase.from("categorias").select("nome, ordem").eq("ativo", true)
          .then(({ data: cats }) => {
            const ordemMap: Record<string, number> = {}
            cats?.forEach(c => { ordemMap[c.nome] = c.ordem })
            setProdutos((prods.data as Produto[]).map(p => ({
              ...p,
              qtd: "",
              categoria_ordem: ordemMap[p.categoria] ?? 99,
            })))
          })
      }
    })
  }, [])

  // ── Salvar lançamento (batch) ─────────────────────────────────
  async function handleSalvar() {
    if (!depositoId) {
      Alert.alert("Atenção", "Selecione o depósito.")
      return
    }
    const isoData = toISO(dataLanc)
    const comQtd = produtos.filter(p => {
      const q = parseInt(p.qtd, 10)
      return !isNaN(q) && q > 0
    })
    if (comQtd.length === 0) {
      Alert.alert("Atenção", "Informe a quantidade para ao menos um produto.")
      return
    }

    setSaving(true)
    try {
      // Insere um movimento individual para cada produto com qtd > 0
      const promises = comQtd.map(p =>
        supabase.rpc("inserir_movimento", {
          p_data:        isoData,
          p_deposito_id: depositoId,
          p_produto_id:  p.id,
          p_tipo:        tipo,
          p_quantidade:  parseInt(p.qtd, 10),
          p_obs:         null,
        })
      )
      const resultados = await Promise.all(promises)
      const erros = resultados.filter(r => r.error).map(r => r.error!.message)
      if (erros.length > 0) throw new Error(erros.join("; "))

      // Limpa as quantidades
      setProdutos(prev => prev.map(p => ({ ...p, qtd: "" })))
      Alert.alert(
        "✓ Lançamento Salvo",
        `${comQtd.length} produto(s) registrado(s) como ${tipo === "abastecimento" ? "abastecimento" : "retirada"}.`
      )
    } catch (e) {
      Alert.alert("Erro ao salvar", (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Carregar histórico ────────────────────────────────────────
  const carregarHistorico = useCallback(async () => {
    if (!user) return
    setLoadingHist(true)
    try {
      const { data, error } = await supabase.rpc("buscar_movimentos_usuario", {
        p_data_inicio:  toISO(dataHistIni),
        p_data_fim:     toISO(dataHistFim),
        p_deposito_id:  depositoHist || null,
        p_user_id:      user.id,
      })
      if (error) throw error
      setHistorico((data ?? []) as MovimentoHistorico[])
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setLoadingHist(false)
      setRefreshingH(false)
    }
  }, [user, dataHistIni, dataHistFim, depositoHist])

  useEffect(() => {
    if (abaAtiva === "historico") carregarHistorico()
  }, [abaAtiva, carregarHistorico])

  // ── Abrir modal de edição ─────────────────────────────────────
  function abrirEditar(mov: MovimentoHistorico) {
    setEditMov(mov)
    setEditQtd(String(mov.quantidade))
    setEditObs(mov.obs ?? "")
    setEditDeposito(mov.deposito_id)
    setEditSaving(false)
  }

  async function salvarEdicao() {
    if (!editMov) return
    const qtd = parseInt(editQtd, 10)
    if (isNaN(qtd) || qtd <= 0) {
      Alert.alert("Valor inválido", "Informe uma quantidade maior que zero.")
      return
    }
    setEditSaving(true)
    try {
      const { error } = await supabase.rpc("atualizar_movimento", {
        p_id:          editMov.id,
        p_quantidade:  qtd,
        p_obs:         editObs.trim() || null,
        p_deposito_id: editDeposito || null,
      })
      if (error) throw error
      setEditMov(null)
      await carregarHistorico()
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setEditSaving(false)
    }
  }

  // ── Produtos agrupados por categoria ─────────────────────────
  const categorias = Array.from(
    new Set(
      [...produtos]
        .sort((a, b) => a.categoria_ordem - b.categoria_ordem || a.ordem_exibicao - b.ordem_exibicao)
        .map(p => p.categoria)
    )
  )

  const produtosPorCategoria = (cat: string) =>
    produtos
      .filter(p => p.categoria === cat)
      .sort((a, b) => a.ordem_exibicao - b.ordem_exibicao)

  function setQtdProduto(id: string, qtd: string) {
    setProdutos(prev => prev.map(p => p.id === id ? { ...p, qtd } : p))
  }

  // ── Render: Aba Lançamento ────────────────────────────────────
  function renderLancamento() {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled">

        {/* Configurações do lançamento */}
        <View style={styles.card}>
          {/* Data */}
          <Text style={styles.label}>Data (dd/mm/aaaa)</Text>
          <TextInput
            style={styles.input}
            value={dataLanc}
            onChangeText={setDataLanc}
            placeholder="dd/mm/aaaa"
            keyboardType="numbers-and-punctuation"
          />

          {/* Depósito */}
          <Text style={[styles.label, { marginTop: 12 }]}>Depósito</Text>
          <DepositoPicker
            depositos={depositos}
            value={depositoId}
            onChange={setDepositoId}
          />

          {/* Tipo */}
          <Text style={[styles.label, { marginTop: 12 }]}>Tipo de Movimento</Text>
          <View style={styles.tipoRow}>
            <TouchableOpacity
              onPress={() => setTipo("abastecimento")}
              style={[styles.tipoBtn, tipo === "abastecimento" && styles.tipoBtnAbast]}>
              <Ionicons
                name="arrow-down-circle-outline" size={18}
                color={tipo === "abastecimento" ? "#fff" : "#64748b"} />
              <Text style={[styles.tipoBtnText, tipo === "abastecimento" && styles.tipoBtnTextActive]}>
                Abastecimento
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setTipo("retirada")}
              style={[styles.tipoBtn, tipo === "retirada" && styles.tipoBtnRetirada]}>
              <Ionicons
                name="arrow-up-circle-outline" size={18}
                color={tipo === "retirada" ? "#fff" : "#64748b"} />
              <Text style={[styles.tipoBtnText, tipo === "retirada" && styles.tipoBtnTextActive]}>
                Retirada
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Produtos por categoria */}
        {loadingLanc ? (
          <ActivityIndicator color="#1e3a5f" style={{ marginTop: 30 }} />
        ) : categorias.map(cat => (
          <View key={cat} style={styles.card}>
            <Text style={styles.catHeader}>{cat}</Text>
            {produtosPorCategoria(cat).map(p => (
              <View key={p.id} style={styles.prodRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prodNome}>{p.nome}</Text>
                  <Text style={styles.prodMarca}>{p.marca}</Text>
                </View>
                <TextInput
                  style={styles.qtdInput}
                  value={p.qtd}
                  onChangeText={v => setQtdProduto(p.id, v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="0"
                  selectTextOnFocus
                />
              </View>
            ))}
          </View>
        ))}

        {/* Botão salvar */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSalvar}
          disabled={saving}
          activeOpacity={0.8}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name="save-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.saveBtnText}>Registrar Lançamento</Text>
              </>
          }
        </TouchableOpacity>
      </ScrollView>
    )
  }

  // ── Render: Aba Histórico ─────────────────────────────────────
  function renderHistorico() {
    return (
      <View style={{ flex: 1 }}>
        {/* Filtros */}
        <View style={styles.filtrosCard}>
          <View style={styles.filtrosRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>De (dd/mm/aaaa)</Text>
              <TextInput
                style={styles.input}
                value={dataHistIni}
                onChangeText={setDataHistIni}
                keyboardType="numbers-and-punctuation"
                placeholder="dd/mm/aaaa"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Até</Text>
              <TextInput
                style={styles.input}
                value={dataHistFim}
                onChangeText={setDataHistFim}
                keyboardType="numbers-and-punctuation"
                placeholder="dd/mm/aaaa"
              />
            </View>
          </View>
          <Text style={[styles.label, { marginTop: 8 }]}>Depósito (opcional)</Text>
          <DepositoPicker
            depositos={[{ id: "", nome: "Todos os depósitos", localizacao: null, ativo: true }, ...depositos]}
            value={depositoHist}
            onChange={setDepositoHist}
          />
          <TouchableOpacity style={styles.filtrarBtn} onPress={carregarHistorico}>
            <Ionicons name="search-outline" size={15} color="#fff" />
            <Text style={styles.filtrarBtnText}>Filtrar</Text>
          </TouchableOpacity>
        </View>

        {loadingHist ? (
          <ActivityIndicator color="#1e3a5f" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={historico}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
            refreshControl={
              <RefreshControl refreshing={refreshingH} onRefresh={() => {
                setRefreshingH(true)
                carregarHistorico()
              }} />
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>Nenhum movimento encontrado.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.histItem}>
                <View style={styles.histBadge}>
                  <Ionicons
                    name={item.tipo === "abastecimento" ? "arrow-down-circle" : "arrow-up-circle"}
                    size={20}
                    color={item.tipo === "abastecimento" ? "#1d4ed8" : "#b45309"}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.histProduto}>{item.produto_nome}</Text>
                  <Text style={styles.histDeposito}>
                    {item.deposito_nome} · {toPT(item.data_referencia)}
                  </Text>
                  <View style={styles.histInfoRow}>
                    <Text style={[styles.histQtd,
                      item.tipo === "abastecimento" ? { color: "#1d4ed8" } : { color: "#b45309" }]}>
                      {item.tipo === "abastecimento" ? "↓" : "↑"} {item.quantidade} un.
                    </Text>
                    {item.obs && <Text style={styles.histObs}>{item.obs}</Text>}
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => abrirEditar(item)}
                  style={styles.editBtn}>
                  <Ionicons name="create-outline" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f1f5f9" }}>
      {/* Seletor de abas internas */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, abaAtiva === "lancamento" && styles.tabBtnActive]}
          onPress={() => setAbaAtiva("lancamento")}>
          <Ionicons
            name="add-circle-outline" size={16}
            color={abaAtiva === "lancamento" ? "#1e3a5f" : "#94a3b8"} />
          <Text style={[styles.tabBtnText, abaAtiva === "lancamento" && styles.tabBtnTextActive]}>
            Lançamento
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, abaAtiva === "historico" && styles.tabBtnActive]}
          onPress={() => setAbaAtiva("historico")}>
          <Ionicons
            name="time-outline" size={16}
            color={abaAtiva === "historico" ? "#1e3a5f" : "#94a3b8"} />
          <Text style={[styles.tabBtnText, abaAtiva === "historico" && styles.tabBtnTextActive]}>
            Histórico
          </Text>
        </TouchableOpacity>
      </View>

      {abaAtiva === "lancamento" ? renderLancamento() : renderHistorico()}

      {/* Modal de edição */}
      <Modal
        visible={!!editMov}
        transparent
        animationType="slide"
        onRequestClose={() => setEditMov(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}>
          <View style={styles.editModal}>
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>Editar Movimento</Text>
              <TouchableOpacity onPress={() => setEditMov(null)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {editMov && (
              <Text style={styles.editModalDesc}>
                {editMov.produto_nome} · {editMov.tipo === "abastecimento" ? "Abastecimento" : "Retirada"}
              </Text>
            )}

            <Text style={styles.label}>Depósito</Text>
            <DepositoPicker
              depositos={depositos}
              value={editDeposito}
              onChange={setEditDeposito}
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Quantidade</Text>
            <TextInput
              style={[styles.input, styles.inputQtdGrande]}
              value={editQtd}
              onChangeText={setEditQtd}
              keyboardType="number-pad"
              autoFocus
              selectTextOnFocus
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Observação (opcional)</Text>
            <TextInput
              style={styles.input}
              value={editObs}
              onChangeText={setEditObs}
              placeholder="Ex: ajuste de inventário..."
            />

            <View style={styles.editModalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditMov(null)}
                disabled={editSaving}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, editSaving && { opacity: 0.6 }]}
                onPress={salvarEdicao}
                disabled={editSaving}>
                {editSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.confirmBtnText}>Salvar</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────
const BLUE = "#1e3a5f"

const styles = StyleSheet.create({
  // Abas internas
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: BLUE },
  tabBtnText: { fontSize: 13, fontWeight: "600", color: "#94a3b8" },
  tabBtnTextActive: { color: BLUE },

  // Cards
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  filtrosCard: {
    backgroundColor: "#fff",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  filtrosRow: { flexDirection: "row", gap: 10 },

  // Labels e inputs
  label: { fontSize: 12, fontWeight: "600", color: "#475569", marginBottom: 6 },
  input: {
    height: 44,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#1e293b",
    backgroundColor: "#f8fafc",
  },
  inputQtdGrande: { fontSize: 24, fontWeight: "700", textAlign: "center" },

  // Picker de depósito
  picker: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#f8fafc",
  },
  pickerText: { fontSize: 14, color: "#1e293b", flex: 1 },
  pickerPlaceholder: { fontSize: 14, color: "#94a3b8", flex: 1 },
  pickerModal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: "60%",
  },
  pickerModalTitle: {
    fontSize: 16, fontWeight: "700", color: BLUE,
    marginBottom: 12, textAlign: "center",
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  pickerItemActive: { backgroundColor: BLUE },
  pickerItemText: { fontSize: 15, color: "#1e293b" },
  pickerItemTextActive: { color: "#fff", fontWeight: "700" },

  // Tipo de movimento
  tipoRow: { flexDirection: "row", gap: 10 },
  tipoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
  },
  tipoBtnAbast:      { backgroundColor: "#1d4ed8", borderColor: "#1d4ed8" },
  tipoBtnRetirada:   { backgroundColor: "#b45309", borderColor: "#b45309" },
  tipoBtnText:       { fontSize: 13, fontWeight: "600", color: "#64748b" },
  tipoBtnTextActive: { color: "#fff" },

  // Categoria header
  catHeader: {
    fontSize: 13, fontWeight: "700", color: "#475569",
    textTransform: "uppercase", letterSpacing: 0.5,
    marginBottom: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },

  // Produto row no lançamento
  prodRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
  },
  prodNome: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  prodMarca: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  qtdInput: {
    width: 70,
    height: 40,
    borderWidth: 1.5,
    borderColor: "#93c5fd",
    borderRadius: 8,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    backgroundColor: "#eff6ff",
  },

  // Botão salvar
  saveBtn: {
    flexDirection: "row",
    height: 52,
    backgroundColor: BLUE,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Filtrar histórico
  filtrarBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    backgroundColor: BLUE,
    borderRadius: 10,
    marginTop: 12,
  },
  filtrarBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // Item do histórico
  histItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  histBadge: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  histProduto: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  histDeposito: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  histInfoRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  histQtd: { fontSize: 13, fontWeight: "700" },
  histObs: { fontSize: 11, color: "#64748b", fontStyle: "italic", flexShrink: 1 },
  editBtn: { padding: 8 },
  emptyText: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },

  // Modal de edição
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  editModal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },
  editModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  editModalTitle: { fontSize: 17, fontWeight: "700", color: BLUE },
  editModalDesc: { fontSize: 13, color: "#64748b", marginBottom: 14 },
  editModalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1, height: 46, borderRadius: 10,
    borderWidth: 1.5, borderColor: "#cbd5e1",
    alignItems: "center", justifyContent: "center",
  },
  cancelBtnText: { fontSize: 15, color: "#475569", fontWeight: "600" },
  confirmBtn: {
    flex: 1, height: 46, borderRadius: 10,
    backgroundColor: BLUE,
    alignItems: "center", justifyContent: "center",
  },
  confirmBtnText: { fontSize: 15, color: "#fff", fontWeight: "700" },
})
