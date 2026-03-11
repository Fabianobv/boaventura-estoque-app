/**
 * app/(tabs)/abastecimento.tsx — Módulo 1: Abastecimento / Retirada
 *
 * Regras de negócio:
 *  - Vários lançamentos podem ser feitos no mesmo dia/depósito
 *  - Cada lançamento soma ao valor existente na tabela (delta)
 *  - O usuário pode editar um lançamento próprio do dia
 *  - A trigger fn_sync_vasilhame_movimentos atualiza vasilhames automaticamente
 */
import { useCallback, useEffect, useState } from "react"
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, Modal, KeyboardAvoidingView,
  Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import type { Deposito, Produto, EstoqueLinha } from "@/lib/types"

// ─── Tipos locais ──────────────────────────────────────────────────
type Tipo = "abastecimento" | "retirada"

interface LancamentoDia {
  produto_id:    string
  produto_nome:  string
  deposito_nome: string
  abastecimento: number
  retirada:      number
  saldo_dia:     number
}

// ─── Tela principal ────────────────────────────────────────────────
export default function AbastecimentoScreen() {
  const { user } = useAuth()

  // Seletores
  const [data,       setData]       = useState(format(new Date(), "yyyy-MM-dd"))
  const [depositoId, setDepositoId] = useState("")
  const [produtoId,  setProdutoId]  = useState("")
  const [quantidade, setQuantidade] = useState("")
  const [tipo,       setTipo]       = useState<Tipo>("abastecimento")

  // Dados
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [produtos,  setProdutos]  = useState<Produto[]>([])
  const [historico, setHistorico] = useState<LancamentoDia[]>([])

  // UI state
  const [loading,    setLoading]    = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving,     setSaving]     = useState(false)

  // Modal de edição (substitui Alert.prompt — iOS only)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editItem,         setEditItem]         = useState<LancamentoDia | null>(null)
  const [editValor,        setEditValor]        = useState("")
  const [editSaving,       setEditSaving]       = useState(false)

  // ── Carregamento inicial ─────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("depositos").select("id, nome, localizacao, ativo").eq("ativo", true).order("nome"),
      supabase.from("produtos").select("id, nome, categoria, marca, is_vasilhame, ordem_exibicao")
        .eq("ativo", true).eq("is_vasilhame", false).order("ordem_exibicao"),
    ]).then(([deps, prods]) => {
      if (deps.data)  {
        setDepositos(deps.data as Deposito[])
        if (deps.data.length > 0) setDepositoId(deps.data[0].id)
      }
      if (prods.data) setProdutos(prods.data as Produto[])
    })
  }, [])

  // ── Carrega histórico do dia/depósito ────────────────────────────
  const carregarHistorico = useCallback(async () => {
    if (!depositoId || !data) return
    setLoading(true)
    try {
      // Inicializa o dia se necessário (garante que todas as linhas existam)
      await supabase.rpc("inicializar_lancamento_diario", {
        p_data: data,
        p_deposito_id: depositoId,
      })

      const { data: rows, error } = await supabase
        .from("vw_estoque_calculado")
        .select("produto_id, produto_nome, deposito_nome, abastecimento, retirada, saldo_do_dia")
        .eq("data_referencia", data)
        .eq("deposito_id", depositoId)
        .or("abastecimento.gt.0,retirada.gt.0")
        .order("produto_nome")

      if (error) throw error
      setHistorico((rows ?? []) as LancamentoDia[])
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [data, depositoId])

  useEffect(() => { carregarHistorico() }, [carregarHistorico])

  // ── Salvar lançamento ────────────────────────────────────────────
  async function handleSalvar() {
    const qtd = parseInt(quantidade, 10)
    if (!depositoId || !produtoId) {
      Alert.alert("Atenção", "Selecione o depósito e o produto.")
      return
    }
    if (isNaN(qtd) || qtd <= 0) {
      Alert.alert("Atenção", "Informe uma quantidade válida (> 0).")
      return
    }

    setSaving(true)
    try {
      // Busca a linha atual do dia
      const { data: linha } = await supabase
        .from("estoque_diario")
        .select("id, abastecimento, retirada")
        .eq("data_referencia", data)
        .eq("deposito_id", depositoId)
        .eq("produto_id", produtoId)
        .maybeSingle()

      const novoAbast   = tipo === "abastecimento" ? (linha?.abastecimento ?? 0) + qtd : (linha?.abastecimento ?? 0)
      const novoRetirada = tipo === "retirada"     ? (linha?.retirada      ?? 0) + qtd : (linha?.retirada      ?? 0)

      // UPSERT na linha do estoque (a trigger atualiza vasilhames automaticamente)
      const { error } = await supabase
        .from("estoque_diario")
        .upsert(
          {
            data_referencia: data,
            deposito_id:     depositoId,
            produto_id:      produtoId,
            abastecimento:   novoAbast,
            retirada:        novoRetirada,
            updated_by:      user?.id,
          },
          { onConflict: "data_referencia,deposito_id,produto_id" }
        )

      if (error) throw error

      setQuantidade("")
      Alert.alert("✓ Salvo", `${tipo === "abastecimento" ? "Abastecimento" : "Retirada"} de ${qtd} unidade(s) registrado!`)
      await carregarHistorico()
    } catch (e) {
      Alert.alert("Erro ao salvar", (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Editar lançamento — abre modal Android-compatível ────────────
  function handleEditar(item: LancamentoDia) {
    setEditItem(item)
    setEditValor(String(item.abastecimento))
    setEditModalVisible(true)
  }

  async function handleEditConfirm() {
    if (!editItem) return
    const qtd = parseInt(editValor, 10)
    if (isNaN(qtd) || qtd < 0) {
      Alert.alert("Valor inválido", "Informe um número inteiro maior ou igual a zero.")
      return
    }
    setEditSaving(true)
    try {
      const { error } = await supabase
        .from("estoque_diario")
        .update({ abastecimento: qtd, updated_by: user?.id })
        .eq("data_referencia", data)
        .eq("deposito_id", depositoId)
        .eq("produto_id", editItem.produto_id)
      if (error) throw error
      setEditModalVisible(false)
      await carregarHistorico()
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setEditSaving(false)
    }
  }

  const depositoSelecionado = depositos.find(d => d.id === depositoId)
  const produtoSelecionado  = produtos.find(p => p.id === produtoId)

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => {
            setRefreshing(true)
            carregarHistorico()
          }} />
        }>

        {/* ── Formulário ──────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Novo Lançamento</Text>

          {/* Data */}
          <Text style={styles.label}>Data</Text>
          <TextInput
            style={styles.input}
            value={data}
            onChangeText={setData}
            placeholder="AAAA-MM-DD"
            keyboardType="numbers-and-punctuation"
          />

          {/* Depósito */}
          <Text style={styles.label}>Depósito</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {depositos.map(d => (
              <TouchableOpacity
                key={d.id}
                onPress={() => setDepositoId(d.id)}
                style={[styles.chip, depositoId === d.id && styles.chipActive]}>
                <Text style={[styles.chipText, depositoId === d.id && styles.chipTextActive]}>
                  {d.nome}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Tipo */}
          <Text style={styles.label}>Tipo de Movimento</Text>
          <View style={styles.tipoRow}>
            <TouchableOpacity
              onPress={() => setTipo("abastecimento")}
              style={[styles.tipoBtn, tipo === "abastecimento" && styles.tipoBtnAbast]}>
              <Ionicons name="arrow-down-circle-outline" size={18}
                color={tipo === "abastecimento" ? "#fff" : "#64748b"} />
              <Text style={[styles.tipoBtnText, tipo === "abastecimento" && styles.tipoBtnTextActive]}>
                Abastecimento
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setTipo("retirada")}
              style={[styles.tipoBtn, tipo === "retirada" && styles.tipoBtnRetirada]}>
              <Ionicons name="arrow-up-circle-outline" size={18}
                color={tipo === "retirada" ? "#fff" : "#64748b"} />
              <Text style={[styles.tipoBtnText, tipo === "retirada" && styles.tipoBtnTextActive]}>
                Retirada
              </Text>
            </TouchableOpacity>
          </View>

          {/* Produto */}
          <Text style={styles.label}>Produto</Text>
          <ScrollView style={styles.produtoList} nestedScrollEnabled>
            {produtos.map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setProdutoId(p.id)}
                style={[styles.produtoItem, produtoId === p.id && styles.produtoItemActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.produtoNome, produtoId === p.id && styles.produtoNomeActive]}>
                    {p.nome}
                  </Text>
                  <Text style={styles.produtoCateg}>{p.categoria} · {p.marca}</Text>
                </View>
                {produtoId === p.id && (
                  <Ionicons name="checkmark-circle" size={20} color="#1e3a5f" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Quantidade */}
          <Text style={styles.label}>Quantidade</Text>
          <TextInput
            style={[styles.input, styles.inputQtd]}
            value={quantidade}
            onChangeText={setQuantidade}
            placeholder="0"
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={handleSalvar}
          />

          {/* Resumo */}
          {produtoSelecionado && depositoSelecionado && (
            <View style={styles.resumo}>
              <Text style={styles.resumoText}>
                {tipo === "abastecimento" ? "📥" : "📤"}{" "}
                <Text style={{ fontWeight: "700" }}>{quantidade || "?"}</Text>
                {" × "}{produtoSelecionado.nome}
                {" → "}{depositoSelecionado.nome}
              </Text>
            </View>
          )}

          {/* Botão salvar */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSalvar}
            disabled={saving}
            activeOpacity={0.8}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="save-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.saveBtnText}>Registrar</Text>
                </>
            }
          </TouchableOpacity>
        </View>

        {/* ── Histórico do dia ────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Histórico — {format(new Date(data + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })}
          </Text>

          {loading ? (
            <ActivityIndicator color="#1e3a5f" style={{ marginVertical: 20 }} />
          ) : historico.length === 0 ? (
            <Text style={styles.emptyText}>
              Nenhum movimento registrado neste dia/depósito.
            </Text>
          ) : (
            historico.map(item => (
              <View key={item.produto_id} style={styles.historicoItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historicoNome}>{item.produto_nome}</Text>
                  <View style={styles.historicoValores}>
                    {item.abastecimento > 0 && (
                      <Text style={styles.valorAbast}>↓ {item.abastecimento}</Text>
                    )}
                    {item.retirada > 0 && (
                      <Text style={styles.valorRetirada}>↑ {item.retirada}</Text>
                    )}
                    <Text style={styles.valorSaldo}>Saldo: {item.saldo_dia}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => handleEditar(item)}
                  style={styles.editBtn}>
                  <Ionicons name="create-outline" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

      </ScrollView>

      {/* ── Modal de edição (Android-compatível) ────────────────── */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Editar Lançamento</Text>
            {editItem && (
              <Text style={styles.modalDesc}>
                {`Produto: ${editItem.produto_nome}\nAbastecimento atual: ${editItem.abastecimento}\nRetirada atual: ${editItem.retirada}`}
              </Text>
            )}
            <Text style={styles.label}>Novo valor total de abastecimento:</Text>
            <TextInput
              style={[styles.input, styles.inputQtd]}
              value={editValor}
              onChangeText={setEditValor}
              keyboardType="number-pad"
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditModalVisible(false)}
                disabled={editSaving}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, editSaving && styles.saveBtnDisabled]}
                onPress={handleEditConfirm}
                disabled={editSaving}>
                {editSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Confirmar</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}

// ─── Estilos ───────────────────────────────────────────────────────
const BLUE = "#1e3a5f"

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#f1f5f9" },
  content:      { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: BLUE, marginBottom: 16 },
  label:        { fontSize: 12, fontWeight: "600", color: "#475569", marginBottom: 6, marginTop: 12 },
  input: {
    height: 44,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: "#1e293b",
    backgroundColor: "#f8fafc",
  },
  inputQtd:     { fontSize: 22, fontWeight: "700", textAlign: "center" },
  chipRow:      { flexDirection: "row", marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    marginRight: 8,
    backgroundColor: "#f8fafc",
  },
  chipActive:     { backgroundColor: BLUE, borderColor: BLUE },
  chipText:       { fontSize: 13, color: "#475569", fontWeight: "500" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  tipoRow:      { flexDirection: "row", gap: 10 },
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
  tipoBtnAbast:       { backgroundColor: "#1d4ed8", borderColor: "#1d4ed8" },
  tipoBtnRetirada:    { backgroundColor: "#b45309", borderColor: "#b45309" },
  tipoBtnText:        { fontSize: 13, fontWeight: "600", color: "#64748b" },
  tipoBtnTextActive:  { color: "#fff" },
  produtoList:  { maxHeight: 180, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, marginBottom: 4 },
  produtoItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  produtoItemActive:  { backgroundColor: "#eff6ff" },
  produtoNome:        { fontSize: 14, color: "#1e293b", fontWeight: "500" },
  produtoNomeActive:  { color: BLUE, fontWeight: "700" },
  produtoCateg:       { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  resumo: {
    backgroundColor: "#f0fdf4",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#22c55e",
  },
  resumoText:   { fontSize: 14, color: "#166534" },
  saveBtn: {
    flexDirection: "row",
    height: 50,
    backgroundColor: BLUE,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  saveBtnDisabled:  { opacity: 0.6 },
  saveBtnText:      { color: "#fff", fontSize: 16, fontWeight: "700" },
  emptyText:        { textAlign: "center", color: "#94a3b8", fontSize: 14, marginVertical: 20 },
  historicoItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  historicoNome:    { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  historicoValores: { flexDirection: "row", gap: 10, marginTop: 4 },
  valorAbast:       { fontSize: 12, color: "#1d4ed8", fontWeight: "600" },
  valorRetirada:    { fontSize: 12, color: "#b45309", fontWeight: "600" },
  valorSaldo:       { fontSize: 12, color: "#475569" },
  editBtn:          { padding: 6 },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalBox: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle:   { fontSize: 17, fontWeight: "700", color: BLUE, marginBottom: 8 },
  modalDesc:    { fontSize: 13, color: "#475569", marginBottom: 4, lineHeight: 20 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  modalCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText:  { fontSize: 15, color: "#475569", fontWeight: "600" },
  modalConfirmBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmText: { fontSize: 15, color: "#fff", fontWeight: "700" },
})
