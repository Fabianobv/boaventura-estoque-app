/**
 * app/(tabs)/contagem.tsx — Contagem de Estoque
 *
 * Fluxo:
 *  1. Sem contagem no dia/depósito → modo edição (steppers ativos + botão Salvar no final)
 *  2. Após salvar → modo visualização com dois botões:
 *     - Editar → volta para modo edição, pode alterar quantitativos e salvar novamente
 *     - Validar → marca status 'validado', registra validated_by + validated_at
 *  3. Após validar → banner verde mostrando quem validou e quando
 *     - Ainda permite edição posterior (muda status de volta para 'pendente')
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, FlatList, Modal, SectionList,
  KeyboardAvoidingView, Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { format, parse, isValid } from "date-fns"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import { onSync } from "@/lib/syncEvent"
import type { Deposito } from "@/lib/types"

const BLUE = "#1e3a5f"

// ─── Máscara de data ──────────────────────────────────────────────
function mascararData(texto: string): string {
  const digits = texto.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function toISO(ddmmaaaa: string): string {
  const d = parse(ddmmaaaa, "dd/MM/yyyy", new Date())
  return isValid(d) ? format(d, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd")
}
function hojePT() { return format(new Date(), "dd/MM/yyyy") }

// ─── Picker de Depósito ───────────────────────────────────────────
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

// ─── Stepper com TextInput ────────────────────────────────────────
function Stepper({
  value, onChange, disabled = false,
}: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const handleText = (txt: string) => {
    const n = parseInt(txt.replace(/[^0-9]/g, ""), 10)
    onChange(isNaN(n) ? 0 : n)
  }
  return (
    <View style={stepperStyles.row}>
      <TouchableOpacity
        style={[stepperStyles.btn, (disabled || value <= 0) && stepperStyles.btnOff]}
        onPress={() => !disabled && onChange(Math.max(0, value - 1))}
        disabled={disabled || value <= 0}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
        <Ionicons name="remove" size={20} color={disabled || value <= 0 ? "#cbd5e1" : BLUE} />
      </TouchableOpacity>
      <TextInput
        style={[stepperStyles.val, disabled && stepperStyles.valOff]}
        value={String(value)}
        onChangeText={handleText}
        keyboardType="number-pad"
        editable={!disabled}
        selectTextOnFocus
      />
      <TouchableOpacity
        style={[stepperStyles.btn, disabled && stepperStyles.btnOff]}
        onPress={() => !disabled && onChange(value + 1)}
        disabled={disabled}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
        <Ionicons name="add" size={20} color={disabled ? "#cbd5e1" : BLUE} />
      </TouchableOpacity>
    </View>
  )
}
const stepperStyles = StyleSheet.create({
  row:    { flexDirection: "row", alignItems: "center", gap: 6 },
  btn:    { width: 36, height: 36, borderRadius: 9, backgroundColor: "#e8eef7", alignItems: "center", justifyContent: "center" },
  btnOff: { backgroundColor: "#f1f5f9" },
  val:    { width: 56, height: 36, borderRadius: 9, borderWidth: 1.5, borderColor: "#93c5fd", textAlign: "center", fontSize: 17, fontWeight: "700", color: "#1e293b", backgroundColor: "#eff6ff" },
  valOff: { borderColor: "#e2e8f0", color: "#94a3b8", backgroundColor: "#f8fafc" },
})

// ─── Tipo local ───────────────────────────────────────────────────
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
  const { user, permissions } = useAuth()

  const [data,          setData]          = useState(hojePT())
  const [depositoId,    setDepositoId]    = useState("")
  const [depositos,     setDepositos]     = useState<Deposito[]>([])
  const [itens,         setItens]         = useState<ItemContagem[]>([])
  const [loading,       setLoading]       = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [refreshing,    setRefreshing]    = useState(false)
  const [isEditing,     setIsEditing]     = useState(true)
  const [responsavel,   setResponsavel]   = useState<string | null>(null)
  const [validadoPor,   setValidadoPor]   = useState<string | null>(null)
  const [validadoEm,    setValidadoEm]    = useState<string | null>(null)
  const [isValidated,   setIsValidated]   = useState(false)

  // Carrega lista de depósitos (aguarda permissions)
  useEffect(() => {
    if (!permissions) return
    supabase.from("depositos")
      .select("id, nome, ativo")
      .eq("ativo", true).order("nome")
      .then(({ data: deps }) => {
        if (deps) {
          const editIds = permissions.deposito_edit_ids ?? []
          const allowed = permissions.isAdmin
            ? (deps as Deposito[])
            : editIds.length > 0
              ? (deps as Deposito[]).filter(d => editIds.includes(d.id))
              : (deps as Deposito[])
          setDepositos(allowed)
          if (allowed.length > 0 && !depositoId) setDepositoId(allowed[0].id)
        }
      })
  }, [permissions])

  // Carrega/recarrega itens do dia+depósito
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
          "diferenca", "updated_by", "validated_by", "validated_at",
        ].join(","))
        .eq("data_referencia", isoData)
        .eq("deposito_id", depositoId)

      if (error) throw error

      const linhas = (rows ?? []) as any[]
      const comContagem = linhas.filter(l => l.contagem_final > 0 || l.avariado > 0)

      if (comContagem.length === 0) {
        setIsEditing(true)
        setResponsavel(null)
        setValidadoPor(null)
        setValidadoEm(null)
        setIsValidated(false)
      } else {
        setIsEditing(false)

        const updatedBy = comContagem[0].updated_by
        if (updatedBy && updatedBy !== user?.id) {
          const { data: perfil } = await supabase
            .from("profiles").select("nome_completo").eq("id", updatedBy).maybeSingle()
          setResponsavel(perfil?.nome_completo ?? "outro usuário")
        } else {
          setResponsavel(null)
        }

        const vBy = comContagem[0].validated_by
        const vAt = comContagem[0].validated_at
        if (vBy) {
          setIsValidated(true)
          setValidadoEm(vAt ? format(new Date(vAt), "dd/MM/yyyy HH:mm") : null)
          if (vBy === user?.id) {
            setValidadoPor("Você")
          } else {
            const { data: perfVal } = await supabase
              .from("profiles").select("nome_completo").eq("id", vBy).maybeSingle()
            setValidadoPor(perfVal?.nome_completo ?? "outro usuário")
          }
        } else {
          setIsValidated(false)
          setValidadoPor(null)
          setValidadoEm(null)
        }
      }

      setItens(
        linhas
          .sort((a: any, b: any) =>
            (a.categoria_ordem ?? 99) - (b.categoria_ordem ?? 99) ||
            (a.produto_ordem ?? 99) - (b.produto_ordem ?? 99)
          )
          .map((l: any) => ({
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

  // Só carrega quando a data é completa (10 chars) e válida (dd/MM/yyyy)
  const dataValida = useMemo(() => {
    if (data.length !== 10) return false
    const parsed = parse(data, "dd/MM/yyyy", new Date())
    if (!isValid(parsed)) return false
    const day = parsed.getDate()
    const month = parsed.getMonth() + 1
    const year = parsed.getFullYear()
    const [dd, mm, yyyy] = data.split("/").map(Number)
    return dd === day && mm === month && yyyy === year && year >= 2020 && year <= 2099
  }, [data])

  useEffect(() => {
    if (dataValida && depositoId) carregarContagem()
  }, [dataValida, depositoId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onSync(() => { if (dataValida && depositoId) carregarContagem() }), [dataValida, depositoId, carregarContagem])

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
        validated_by:    null,
        validated_at:    null,
      }))
      const { error } = await supabase
        .from("estoque_diario")
        .upsert(upserts, { onConflict: "data_referencia,deposito_id,produto_id" })
      if (error) throw error
      setIsEditing(false)
      setIsValidated(false)
      setValidadoPor(null)
      setValidadoEm(null)
      setResponsavel(null)
      Alert.alert("✓ Contagem Salva", "Os dados foram registrados com sucesso!")
    } catch (e) {
      Alert.alert("Erro ao salvar", (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleValidar() {
    Alert.alert(
      "Validar Contagem",
      "Confirma que a contagem registrada está correta?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar", onPress: async () => {
            setSaving(true)
            try {
              const { error } = await supabase
                .from("estoque_diario")
                .update({
                  validated_by: user?.id,
                  validated_at: new Date().toISOString(),
                })
                .eq("data_referencia", toISO(data))
                .eq("deposito_id", depositoId)
              if (error) throw error
              setIsValidated(true)
              setValidadoPor("Você")
              setValidadoEm(format(new Date(), "dd/MM/yyyy HH:mm"))
              Alert.alert("✓ Validado", "Contagem validada com sucesso!")
            } catch (e) {
              Alert.alert("Erro", (e as Error).message)
            } finally {
              setSaving(false)
            }
          },
        },
      ]
    )
  }

  const categorias = useMemo(() => Array.from(new Set(itens.map(i => i.produto_categ))), [itens])
  const itensDeCat = useCallback((cat: string) => itens.filter(i => i.produto_categ === cat), [itens])

  function renderItem(item: ItemContagem) {
    const dif = item.diferenca
    const difColor = dif < 0 ? "#dc2626" : dif > 0 ? "#d97706" : "#16a34a"
    const difStr   = dif > 0 ? `+${dif}` : String(dif)
    return (
      <View key={item.produto_id} style={styles.item}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemNome}>{item.produto_nome}</Text>
          <View style={styles.saldoTag}>
            <Text style={styles.saldoTagLabel}>Sistema</Text>
            <Text style={styles.saldoTagVal}>{item.saldo_calculado}</Text>
          </View>
        </View>
        <View style={styles.stepperLine}>
          <Text style={styles.stepperLineLabel}>Contagem Final</Text>
          <Stepper value={item.contagem_final} onChange={v => updateItem(item.produto_id, "contagem_final", v)} disabled={!isEditing} />
        </View>
        <View style={styles.stepperLine}>
          <Text style={styles.stepperLineLabel}>Avariado</Text>
          <Stepper value={item.avariado} onChange={v => updateItem(item.produto_id, "avariado", v)} disabled={!isEditing} />
        </View>
        <View style={[styles.stepperLine, { borderBottomWidth: 0, paddingBottom: 2 }]}>
          <Text style={styles.stepperLineLabel}>Diferença</Text>
          <Text style={[styles.difVal, { color: difColor }]}>{difStr}</Text>
        </View>
      </View>
    )
  }

  // Header scrollável: controles de data/depósito + banners
  const ListHeader = (
    <View>
      <View style={styles.controls}>
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.controlLabel}>Data (dd/mm/aaaa)</Text>
          <TextInput style={styles.controlInput} value={data} onChangeText={v => setData(mascararData(v))} placeholder="dd/mm/aaaa" keyboardType="number-pad" maxLength={10} />
        </View>
        <Text style={styles.controlLabel}>Depósito</Text>
        <DepositoPicker depositos={depositos} value={depositoId} onChange={setDepositoId} />
      </View>

      {!isEditing && isValidated && (
        <View style={styles.bannerValidado}>
          <Ionicons name="shield-checkmark" size={16} color="#166534" />
          <Text style={[styles.bannerText, { color: "#166534" }]}>
            Validado por <Text style={{ fontWeight: "700" }}>{validadoPor}</Text>
            {validadoEm ? ` em ${validadoEm}` : ""}
          </Text>
        </View>
      )}

      {!isEditing && !isValidated && (
        responsavel ? (
          <View style={styles.bannerAviso}>
            <Ionicons name="person-circle-outline" size={16} color="#92400e" />
            <Text style={styles.bannerText}>
              Registrado por <Text style={{ fontWeight: "700" }}>{responsavel}</Text>
            </Text>
          </View>
        ) : (
          <View style={styles.bannerOk}>
            <Ionicons name="checkmark-circle-outline" size={16} color="#166534" />
            <Text style={[styles.bannerText, { color: "#166534" }]}>
              Contagem salva. Aguardando validação.
            </Text>
          </View>
        )
      )}
    </View>
  )

  // Footer scrollável: botões de ação (dentro da SectionList)
  const ListFooter = !loading && itens.length > 0 ? (
    <View style={styles.footerInList}>
      {isEditing ? (
        <TouchableOpacity
          style={[styles.footerBtn, styles.footerBtnSalvar, saving && { opacity: 0.6 }]}
          onPress={handleSalvar} disabled={saving} activeOpacity={0.8}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <><Ionicons name="save-outline" size={18} color="#fff" /><Text style={styles.footerBtnText}>Salvar Contagem</Text></>
          }
        </TouchableOpacity>
      ) : (
        <View style={styles.footerRow}>
          <TouchableOpacity
            style={[styles.footerBtn, styles.footerBtnEditar]}
            onPress={() => setIsEditing(true)} disabled={saving} activeOpacity={0.8}>
            <Ionicons name="create-outline" size={18} color="#fff" />
            <Text style={styles.footerBtnText}>Editar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerBtn, isValidated ? styles.footerBtnRevalidar : styles.footerBtnValidar]}
            onPress={handleValidar} disabled={saving} activeOpacity={0.8}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <><Ionicons name="shield-checkmark-outline" size={18} color="#fff" /><Text style={styles.footerBtnText}>{isValidated ? "Revalidar" : "Validar"}</Text></>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  ) : null

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>

      {loading ? (
        <>
          {ListHeader}
          <ActivityIndicator color={BLUE} style={{ flex: 1, marginTop: 40 }} />
        </>
      ) : itens.length === 0 ? (
        <>
          {ListHeader}
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <Text style={styles.emptyText}>Nenhum produto encontrado.</Text>
          </View>
        </>
      ) : (
        <SectionList
          sections={categorias.map(cat => ({ title: cat, data: itensDeCat(cat) }))}
          keyExtractor={(item) => item.produto_id}
          renderItem={({ item }) => renderItem(item)}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.catHeader}>{title}</Text>
          )}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          contentContainerStyle={styles.lista}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); carregarContagem() }} />}
          maxToRenderPerBatch={30}
          updateCellsBatchingPeriod={50}
          stickySectionHeadersEnabled={false}
        />
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },
  controls: { backgroundColor: "#fff", padding: 14, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  controlLabel: { fontSize: 12, fontWeight: "600", color: "#475569", marginBottom: 6 },
  controlInput: { height: 44, borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, fontSize: 14, color: "#1e293b", backgroundColor: "#f8fafc" },
  picker: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, backgroundColor: "#f8fafc" },
  pickerText: { fontSize: 14, color: "#1e293b", flex: 1 },
  pickerPlaceholder: { fontSize: 14, color: "#94a3b8", flex: 1 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerModal: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: "60%" },
  pickerModalTitle: { fontSize: 16, fontWeight: "700", color: BLUE, marginBottom: 12, textAlign: "center" },
  pickerItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  pickerItemActive: { backgroundColor: BLUE },
  pickerItemText: { fontSize: 15, color: "#1e293b" },
  pickerItemTextActive: { color: "#fff", fontWeight: "700" },
  bannerAviso: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef3c7", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#fde68a" },
  bannerOk: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f0fdf4", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#bbf7d0" },
  bannerValidado: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#dcfce7", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#86efac" },
  bannerText: { fontSize: 13, color: "#92400e", flex: 1 },
  lista: { paddingHorizontal: 12, paddingBottom: 20 },
  emptyText: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  catHeader: { fontSize: 12, fontWeight: "700", color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, paddingVertical: 6, paddingHorizontal: 4, marginTop: 8, marginBottom: 4 },
  item: { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  itemHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  itemNome: { fontSize: 15, fontWeight: "700", color: "#1e293b", flex: 1, marginRight: 8 },
  saldoTag: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f1f5f9", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  saldoTagLabel: { fontSize: 11, color: "#64748b", fontWeight: "600" },
  saldoTagVal: { fontSize: 13, color: "#1e293b", fontWeight: "700" },
  stepperLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  stepperLineLabel: { fontSize: 13, color: "#475569", fontWeight: "600" },
  difVal: { fontSize: 18, fontWeight: "700" },
  footerInList: { paddingVertical: 16 },
  footerRow: { flexDirection: "row", gap: 10 },
  footerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 12 },
  footerBtnSalvar: { backgroundColor: BLUE },
  footerBtnEditar: { backgroundColor: "#d97706" },
  footerBtnValidar: { backgroundColor: "#16a34a" },
  footerBtnRevalidar: { backgroundColor: "#0d9488" },
  footerBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
})
