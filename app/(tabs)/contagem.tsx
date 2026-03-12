/**
 * app/(tabs)/contagem.tsx — Contagem de Estoque
 *
 * Regras:
 *  - Uma contagem por dia/depósito
 *  - Outro usuário pode editar ou validar a contagem existente
 *  - Produtos agrupados por categoria (ordem da tabela categorias)
 *  - Data no formato dd/mm/aaaa com máscara automática
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, FlatList, Modal,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { format, parse, isValid } from "date-fns"
import { ptBR } from "date-fns/locale"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import { onSync } from "@/lib/syncEvent"
import type { Deposito, EstoqueLinha } from "@/lib/types"

// ─── Máscara de data ──────────────────────────────────────────────
function mascararData(texto: string): string {
  const digits = texto.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

// ─── Helpers de data ──────────────────────────────────────────────
function toISO(ddmmaaaa: string): string {
  const d = parse(ddmmaaaa, "dd/MM/yyyy", new Date())
  return isValid(d) ? format(d, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd")
}
function hojePT() { return format(new Date(), "dd/MM/yyyy") }

// ─── Stepper compacto ─────────────────────────────────────────────
function Stepper({
  value, onChange, disabled = false,
}: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <View style={stepStyles.row}>
      <TouchableOpacity
        style={[stepStyles.btn, disabled && stepStyles.btnDisabled]}
        onPress={() => !disabled && onChange(Math.max(0, value - 1))}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text style={[stepStyles.btnText, disabled && stepStyles.btnTextDisabled]}>−</Text>
      </TouchableOpacity>
      <Text style={[stepStyles.val, disabled && stepStyles.valDisabled]}>{value}</Text>
      <TouchableOpacity
        style={[stepStyles.btn, disabled && stepStyles.btnDisabled]}
        onPress={() => !disabled && onChange(value + 1)}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text style={[stepStyles.btnText, disabled && stepStyles.btnTextDisabled]}>+</Text>
      </TouchableOpacity>
    </View>
  )
}
const stepStyles = StyleSheet.create({
  row:          { flexDirection: "row", alignItems: "center", gap: 2 },
  btn:          { width: 24, height: 24, borderRadius: 6, backgroundColor: "#1e3a5f", alignItems: "center", justifyContent: "center" },
  btnDisabled:  { backgroundColor: "#cbd5e1" },
  btnText:      { color: "#fff", fontSize: 16, fontWeight: "700", lineHeight: 20 },
  btnTextDisabled: { color: "#94a3b8" },
  val:          { minWidth: 26, textAlign: "center", fontSize: 15, fontWeight: "700", color: "#1e293b" },
  valDisabled:  { color: "#94a3b8" },
})

// ─── Picker reutilizável ──────────────────────────────────────────
function DepositoPicker({
  depositos, value, onChange,
}: { depositos: Deposito[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const sel = depositos.find(d => d.id === value)
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.picker} activeOpacity={0.7}>
        <Text style={sel ? styles.pickerText : styles.pickerPlaceholder}>
          {sel ? sel.nome : "Selecione o depósito..."}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
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

// ─── Tipos locais ─────────────────────────────────────────────────
type StatusContagem = "nova" | "minha" | "outro_usuario"

interface ItemContagem {
  produto_id:      string
  produto_nome:    string
  produto_categ:   string
  categoria_ordem: number
  produto_ordem:   number
  saldo_calculado: number
  contagem_final:  number
  avariado:        number
  diferenca:       number
}

// ─── Tela principal ───────────────────────────────────────────────
export default function ContagemScreen() {
  const { user } = useAuth()

  const [data,       setData]       = useState(hojePT())
  const [depositoId, setDepositoId] = useState("")
  const [depositos,  setDepositos]  = useState<Deposito[]>([])

  const [status,     setStatus]     = useState<StatusContagem>("nova")
  const [itens,      setItens]      = useState<ItemContagem[]>([])
  const [loading,    setLoading]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [responsavel, setResponsavel] = useState<string | null>(null)

  useEffect(() => {
    supabase.from("depositos")
      .select("id, nome, ativo")
      .eq("ativo", true).order("nome")
      .then(({ data: deps }) => {
        if (deps) {
          setDepositos(deps as Deposito[])
          if (deps.length > 0) setDepositoId(deps[0].id)
        }
      })
  }, [])

  const carregarContagem = useCallback(async () => {
    if (!depositoId || !data) return
    setLoading(true)
    try {
      const isoData = toISO(data)
      await supabase.rpc("inicializar_lancamento_diario", {
        p_data: isoData,
        p_deposito_id: depositoId,
      })

      const { data: rows, error } = await supabase
        .from("vw_estoque_calculado")
        .select([
          "produto_id", "produto_nome", "produto_categoria", "categoria_ordem",
          "produto_ordem", "saldo_do_dia", "contagem_final", "avariado",
          "diferenca", "updated_by",
        ].join(","))
        .eq("data_referencia", isoData)
        .eq("deposito_id", depositoId)

      if (error) throw error

      const linhas = (rows ?? []) as any[]
      const comContagem = linhas.filter(l => l.contagem_final > 0 || l.avariado > 0)

      if (comContagem.length === 0) {
        setStatus("nova")
        setResponsavel(null)
      } else {
        const updatedBy = comContagem[0].updated_by
        if (updatedBy === user?.id) {
          setStatus("minha")
        } else {
          setStatus("outro_usuario")
          if (updatedBy) {
            const { data: perfil } = await supabase
              .from("profiles")
              .select("nome_completo")
              .eq("id", updatedBy)
              .maybeSingle()
            setResponsavel(perfil?.nome_completo ?? "outro usuário")
          }
        }
      }

      setItens(
        linhas
          .sort((a, b) =>
            (a.categoria_ordem ?? 99) - (b.categoria_ordem ?? 99) ||
            (a.produto_ordem ?? 99) - (b.produto_ordem ?? 99)
          )
          .map(l => ({
            produto_id:      l.produto_id,
            produto_nome:    l.produto_nome,
            produto_categ:   l.produto_categoria,
            categoria_ordem: l.categoria_ordem ?? 99,
            produto_ordem:   l.produto_ordem ?? 99,
            saldo_calculado: l.saldo_do_dia ?? 0,
            contagem_final:  l.contagem_final ?? 0,
            avariado:        l.avariado ?? 0,
            diferenca:       l.diferenca ?? 0,
          }))
      )
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [data, depositoId, user?.id])

  useEffect(() => { carregarContagem() }, [carregarContagem])

  // Listener do botão "Sincronizar" no header
  useEffect(() => onSync(carregarContagem), [carregarContagem])

  function updateItem(produtoId: string, campo: "contagem_final" | "avariado", valor: number) {
    setItens(prev => prev.map(it => {
      if (it.produto_id !== produtoId) return it
      const novo = { ...it, [campo]: valor }
      novo.diferenca = (novo.contagem_final + novo.avariado) - novo.saldo_calculado
      return novo
    }))
  }

  async function handleSalvar() {
    setSaving(true)
    try {
      const isoData = toISO(data)
      const upserts = itens.map(it => ({
        data_referencia: isoData,
        deposito_id:     depositoId,
        produto_id:      it.produto_id,
        contagem_final:  it.contagem_final,
        avariado:        it.avariado,
        updated_by:      user?.id,
      }))
      const { error } = await supabase
        .from("estoque_diario")
        .upsert(upserts, { onConflict: "data_referencia,deposito_id,produto_id" })
      if (error) throw error
      setStatus("minha")
      Alert.alert("✓ Contagem Salva", "Os dados foram registrados com sucesso!")
    } catch (e) {
      Alert.alert("Erro ao salvar", (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function handleValidar() {
    Alert.alert(
      "Validar Contagem",
      `Confirma que a contagem feita por ${responsavel ?? "outro usuário"} está correta?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: async () => {
          setSaving(true)
          const { error } = await supabase
            .from("estoque_diario")
            .update({
              validated_by: user?.id,
              validated_at: new Date().toISOString(),
            })
            .eq("data_referencia", toISO(data))
            .eq("deposito_id", depositoId)
          setSaving(false)
          if (error) { Alert.alert("Erro", error.message); return }
          setStatus("minha")
          Alert.alert("✓ Validado", "Contagem confirmada por você.")
        }},
      ]
    )
  }

  // Agrupa por categoria
  const categorias = Array.from(new Set(itens.map(i => i.produto_categ)))
  const itensDeCat = (cat: string) => itens.filter(i => i.produto_categ === cat)

  const canEdit = status === "nova" || status === "minha"

  function renderItem(item: ItemContagem) {
    const difColor = item.diferenca < 0 ? "#dc2626" : item.diferenca > 0 ? "#d97706" : "#16a34a"
    return (
      <View key={item.produto_id} style={styles.item}>
        <Text style={styles.itemNome}>{item.produto_nome}</Text>
        <View style={styles.itemRow}>
          {/* Sistema */}
          <View style={styles.itemCol}>
            <Text style={styles.itemLabel}>Sistema</Text>
            <Text style={styles.itemValorNeutro}>{item.saldo_calculado}</Text>
          </View>
          {/* Contagem */}
          <View style={styles.itemCol}>
            <Text style={styles.itemLabel}>Contagem</Text>
            {canEdit ? (
              <Stepper
                value={item.contagem_final}
                onChange={v => updateItem(item.produto_id, "contagem_final", v)}
              />
            ) : (
              <Text style={styles.itemValorNeutro}>{item.contagem_final}</Text>
            )}
          </View>
          {/* Avariado */}
          <View style={styles.itemCol}>
            <Text style={styles.itemLabel}>Avariado</Text>
            {canEdit ? (
              <Stepper
                value={item.avariado}
                onChange={v => updateItem(item.produto_id, "avariado", v)}
              />
            ) : (
              <Text style={styles.itemValorNeutro}>{item.avariado}</Text>
            )}
          </View>
          {/* Diferença */}
          <View style={styles.itemCol}>
            <Text style={styles.itemLabel}>Diferença</Text>
            <Text style={[styles.itemValorDif, { color: difColor }]}>
              {item.diferenca > 0 ? `+${item.diferenca}` : item.diferenca}
            </Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Controles */}
      <View style={styles.controls}>
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.controlLabel}>Data (dd/mm/aaaa)</Text>
          <TextInput
            style={styles.controlInput}
            value={data}
            onChangeText={v => setData(mascararData(v))}
            placeholder="dd/mm/aaaa"
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>
        <Text style={styles.controlLabel}>Depósito</Text>
        <DepositoPicker depositos={depositos} value={depositoId} onChange={setDepositoId} />
      </View>

      {/* Banners de status */}
      {status === "outro_usuario" && (
        <View style={styles.bannerAviso}>
          <Ionicons name="warning-outline" size={16} color="#92400e" />
          <Text style={styles.bannerText}>
            Contagem iniciada por <Text style={{ fontWeight: "700" }}>{responsavel}</Text>.
          </Text>
        </View>
      )}
      {status === "minha" && (
        <View style={styles.bannerOk}>
          <Ionicons name="checkmark-circle-outline" size={16} color="#166534" />
          <Text style={[styles.bannerText, { color: "#166534" }]}>
            Contagem registrada por você. Edição disponível.
          </Text>
        </View>
      )}

      {/* Lista por categoria */}
      {loading ? (
        <ActivityIndicator color="#1e3a5f" style={{ flex: 1, marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.lista}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => {
              setRefreshing(true)
              carregarContagem()
            }} />
          }>
          {itens.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum produto encontrado.</Text>
          ) : (
            categorias.map(cat => (
              <View key={cat}>
                <Text style={styles.catHeader}>{cat}</Text>
                {itensDeCat(cat).map(item => renderItem(item))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Botões de ação no rodapé (não fixo) */}
      {!loading && itens.length > 0 && (
        <View style={styles.footer}>
          {status === "outro_usuario" ? (
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerBtnValidar]}
                onPress={handleValidar} disabled={saving}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                <Text style={styles.footerBtnText}>Validar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerBtnEditar]}
                onPress={() => setStatus("minha")} disabled={saving}>
                <Ionicons name="create-outline" size={18} color="#fff" />
                <Text style={styles.footerBtnText}>Editar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnSalvar, saving && { opacity: 0.6 }]}
              onPress={handleSalvar} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Ionicons name="save-outline" size={18} color="#fff" />
                    <Text style={styles.footerBtnText}>Salvar Contagem</Text>
                  </>
              }
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

const BLUE = "#1e3a5f"
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },
  controls: {
    backgroundColor: "#fff",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  controlLabel: { fontSize: 12, fontWeight: "600", color: "#475569", marginBottom: 6 },
  controlInput: {
    height: 44, borderWidth: 1.5, borderColor: "#e2e8f0",
    borderRadius: 10, paddingHorizontal: 12, fontSize: 14,
    color: "#1e293b", backgroundColor: "#f8fafc",
  },
  picker: {
    height: 44, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", borderWidth: 1.5,
    borderColor: "#e2e8f0", borderRadius: 10,
    paddingHorizontal: 12, backgroundColor: "#f8fafc",
  },
  pickerText: { fontSize: 14, color: "#1e293b", flex: 1 },
  pickerPlaceholder: { fontSize: 14, color: "#94a3b8", flex: 1 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerModal: {
    backgroundColor: "#fff", borderTopLeftRadius: 20,
    borderTopRightRadius: 20, padding: 16, maxHeight: "60%",
  },
  pickerModalTitle: {
    fontSize: 16, fontWeight: "700", color: BLUE,
    marginBottom: 12, textAlign: "center",
  },
  pickerItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4,
  },
  pickerItemActive: { backgroundColor: BLUE },
  pickerItemText: { fontSize: 15, color: "#1e293b" },
  pickerItemTextActive: { color: "#fff", fontWeight: "700" },
  bannerAviso: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef3c7", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#fde68a",
  },
  bannerOk: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#f0fdf4", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#bbf7d0",
  },
  bannerText: { fontSize: 13, color: "#92400e" },
  lista: { padding: 12, paddingBottom: 16 },
  emptyText: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  catHeader: {
    fontSize: 12, fontWeight: "700", color: "#475569",
    textTransform: "uppercase", letterSpacing: 0.5,
    paddingVertical: 6, paddingHorizontal: 4,
    marginTop: 8, marginBottom: 4,
  },
  item: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    marginBottom: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  itemNome: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginBottom: 10 },
  itemRow: { flexDirection: "row", gap: 2 },
  itemCol: { flex: 1, alignItems: "center", overflow: "hidden" },
  itemLabel: { fontSize: 10, fontWeight: "600", color: "#94a3b8", marginBottom: 4, textTransform: "uppercase" },
  itemValorNeutro: { fontSize: 18, fontWeight: "700", color: "#334155" },
  itemValorDif: { fontSize: 18, fontWeight: "700" },
  footer: {
    padding: 16, backgroundColor: "#fff",
    borderTopWidth: 1, borderTopColor: "#e2e8f0",
  },
  footerRow: { flexDirection: "row", gap: 10 },
  footerBtn: {
    flex: 1, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8, height: 50, borderRadius: 12,
  },
  footerBtnSalvar:  { backgroundColor: BLUE },
  footerBtnValidar: { backgroundColor: "#16a34a" },
  footerBtnEditar:  { backgroundColor: "#d97706" },
  footerBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
})
