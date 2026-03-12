/**
 * app/(tabs)/abastecimento.tsx — Lançamento e Histórico de Movimentos
 *
 * Aba 1 – Lançamento:
 *   • Data com máscara automática (dd/mm/aaaa)
 *   • Seleciona depósito e tipo (Abastec./Retirada)
 *   • Produtos com stepper (+/-) de quantidade
 *
 * Aba 2 – Histórico:
 *   • Filtro de dia único + depósito
 *   • Movimentos agrupados por "lote" (mesmo dep/tipo/minuto)
 *   • Toque num lote → abre modal de edição com todos os produtos
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { onSync } from "@/lib/syncEvent"
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
function hojePT() { return format(new Date(), "dd/MM/yyyy") }

/** Aplica máscara dd/MM/yyyy enquanto o usuário digita apenas números */
function mascararData(texto: string): string {
  const nums = texto.replace(/\D/g, "").slice(0, 8)
  if (nums.length <= 2) return nums
  if (nums.length <= 4) return `${nums.slice(0, 2)}/${nums.slice(2)}`
  return `${nums.slice(0, 2)}/${nums.slice(2, 4)}/${nums.slice(4)}`
}

// ─── Tipos locais ─────────────────────────────────────────────────
type Tipo = "abastecimento" | "retirada"

interface ProdutoComQtd extends Produto {
  qtd: string
  categoria_ordem: number
}

interface MovimentoHistorico {
  id: string
  data_referencia: string
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

interface Lote {
  key: string
  data_referencia: string
  deposito_id: string
  deposito_nome: string
  tipo: Tipo
  created_at: string
  movimentos: MovimentoHistorico[]
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

// ─── Componente: Stepper de Quantidade ────────────────────────────
function Stepper({
  value, onChange, minWidth = 60,
}: { value: string; onChange: (v: string) => void; minWidth?: number }) {
  const num = parseInt(value, 10) || 0
  return (
    <View style={styles.stepperContainer}>
      <TouchableOpacity
        onPress={() => onChange(String(Math.max(0, num - 1)))}
        style={styles.stepperBtn}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
        <Ionicons name="remove" size={18} color={num > 0 ? BLUE : "#cbd5e1"} />
      </TouchableOpacity>
      <TextInput
        style={[styles.qtdInput, { minWidth }]}
        value={value}
        onChangeText={v => onChange(v.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="0"
        selectTextOnFocus
      />
      <TouchableOpacity
        onPress={() => onChange(String(num + 1))}
        style={styles.stepperBtn}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
        <Ionicons name="add" size={18} color={BLUE} />
      </TouchableOpacity>
    </View>
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
  const [dataHist,     setDataHist]     = useState(hojePT())
  const [depositoHist, setDepositoHist] = useState("")
  const [historico,    setHistorico]    = useState<MovimentoHistorico[]>([])
  const [loadingHist,  setLoadingHist]  = useState(false)
  const [refreshingH,  setRefreshingH]  = useState(false)

  // ── Estado: Modal edição de lote ──────────────────────────────
  const [editLote,     setEditLote]    = useState<Lote | null>(null)
  const [editDeposito, setEditDeposito] = useState("")
  const [editQtds,     setEditQtds]    = useState<Record<string, string>>({})
  const [editSaving,   setEditSaving]  = useState(false)

  // ── Carregamento de depósitos e produtos ─────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("depositos").select("id, nome, localizacao, ativo").eq("ativo", true).order("nome"),
      supabase.from("produtos")
        .select("id, nome, categoria, marca, is_vasilhame, ordem_exibicao, ativo")
        .eq("ativo", true)
        .order("ordem_exibicao"),
    ]).then(([deps, prods]) => {
      if (deps.data) {
        setDepositos(deps.data as Deposito[])
        if (deps.data.length > 0) setDepositoId(deps.data[0].id)
      }
      if (prods.data) {
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
      const resultados = await Promise.all(comQtd.map(p =>
        supabase.rpc("inserir_movimento", {
          p_data: isoData, p_deposito_id: depositoId,
          p_produto_id: p.id, p_tipo: tipo,
          p_quantidade: parseInt(p.qtd, 10), p_obs: null,
        })
      ))
      const erros = resultados.filter(r => r.error).map(r => r.error!.message)
      if (erros.length > 0) throw new Error(erros.join("; "))
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

  // ── Carregar histórico (dia único) ────────────────────────────
  const carregarHistorico = useCallback(async () => {
    if (!user) return
    setLoadingHist(true)
    try {
      const dataISO = toISO(dataHist)
      const { data, error } = await supabase.rpc("buscar_movimentos_usuario", {
        p_data_inicio: dataISO,
        p_data_fim:    dataISO,
        p_deposito_id: depositoHist || null,
        p_user_id:     user.id,
      })
      if (error) throw error
      setHistorico((data ?? []) as MovimentoHistorico[])
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setLoadingHist(false)
      setRefreshingH(false)
    }
  }, [user, dataHist, depositoHist])

  useEffect(() => {
    if (abaAtiva === "historico") carregarHistorico()
  }, [abaAtiva, carregarHistorico])

  // Listener do botão "Sincronizar" no header
  useEffect(() => onSync(() => {
    if (abaAtiva === "historico") carregarHistorico()
  }), [abaAtiva, carregarHistorico])

  // ── Agrupar histórico em lotes ────────────────────────────────
  const lotes = useMemo<Lote[]>(() => {
    const map = new Map<string, MovimentoHistorico[]>()
    historico.forEach(m => {
      const minuto = m.created_at.substring(0, 16)
      const chave = `${m.data_referencia}|${m.deposito_id}|${m.tipo}|${minuto}`
      if (!map.has(chave)) map.set(chave, [])
      map.get(chave)!.push(m)
    })
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, movs]) => ({
        key,
        data_referencia: movs[0].data_referencia,
        deposito_id: movs[0].deposito_id,
        deposito_nome: movs[0].deposito_nome,
        tipo: movs[0].tipo,
        created_at: movs[0].created_at,
        movimentos: movs,
      }))
  }, [historico])

  // ── Abrir modal edição de lote ────────────────────────────────
  function abrirEditarLote(lote: Lote) {
    setEditLote(lote)
    setEditDeposito(lote.deposito_id)
    const qtds: Record<string, string> = {}
    lote.movimentos.forEach(m => { qtds[m.id] = String(m.quantidade) })
    setEditQtds(qtds)
    setEditSaving(false)
  }

  async function salvarEdicaoLote() {
    if (!editLote) return
    setEditSaving(true)
    try {
      await Promise.all(editLote.movimentos.map(m => {
        const qtd = parseInt(editQtds[m.id] || "0", 10)
        return supabase.rpc("atualizar_movimento", {
          p_id:          m.id,
          p_quantidade:  qtd > 0 ? qtd : m.quantidade,
          p_obs:         m.obs,
          p_deposito_id: editDeposito || m.deposito_id,
        })
      }))
      setEditLote(null)
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
    produtos.filter(p => p.categoria === cat).sort((a, b) => a.ordem_exibicao - b.ordem_exibicao)

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

        <View style={styles.card}>
          {/* Data com máscara */}
          <Text style={styles.label}>Data</Text>
          <TextInput
            style={styles.input}
            value={dataLanc}
            onChangeText={v => setDataLanc(mascararData(v))}
            placeholder="dd/mm/aaaa"
            keyboardType="number-pad"
            maxLength={10}
          />

          {/* Depósito */}
          <Text style={[styles.label, { marginTop: 12 }]}>Depósito</Text>
          <DepositoPicker depositos={depositos} value={depositoId} onChange={setDepositoId} />

          {/* Tipo */}
          <Text style={[styles.label, { marginTop: 12 }]}>Tipo de Movimento</Text>
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
        </View>

        {/* Produtos por categoria com stepper */}
        {loadingLanc ? (
          <ActivityIndicator color={BLUE} style={{ marginTop: 30 }} />
        ) : categorias.map(cat => (
          <View key={cat} style={styles.card}>
            <Text style={styles.catHeader}>{cat}</Text>
            {produtosPorCategoria(cat).map(p => (
              <View key={p.id} style={styles.prodRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prodNome}>{p.nome}</Text>
                  <Text style={styles.prodMarca}>{p.marca}</Text>
                </View>
                <Stepper value={p.qtd} onChange={v => setQtdProduto(p.id, v)} />
              </View>
            ))}
          </View>
        ))}

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
    const totalQtd = historico.reduce((s, m) => s + m.quantidade, 0)

    const ListHeader = (
      <View style={styles.filtrosCard}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Data</Text>
            <TextInput
              style={styles.input}
              value={dataHist}
              onChangeText={v => setDataHist(mascararData(v))}
              keyboardType="number-pad"
              placeholder="dd/mm/aaaa"
              maxLength={10}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Depósito (opcional)</Text>
            <DepositoPicker
              depositos={[{ id: "", nome: "Todos", localizacao: null, ativo: true }, ...depositos]}
              value={depositoHist}
              onChange={setDepositoHist}
            />
          </View>
        </View>
        <TouchableOpacity style={styles.filtrarBtn} onPress={carregarHistorico}>
          <Ionicons name="search-outline" size={15} color="#fff" />
          <Text style={styles.filtrarBtnText}>Buscar</Text>
        </TouchableOpacity>
        {lotes.length > 0 && (
          <Text style={styles.resumoText}>
            {lotes.length} lote(s) · {historico.length} produto(s) · {totalQtd} un. total
          </Text>
        )}
      </View>
    )

    return (
      <FlatList
        data={lotes}
        keyExtractor={l => l.key}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListHeaderComponent={ListHeader}
        refreshControl={
          <RefreshControl refreshing={refreshingH} onRefresh={() => {
            setRefreshingH(true); carregarHistorico()
          }} />
        }
        ListEmptyComponent={
          loadingHist
            ? <ActivityIndicator color={BLUE} style={{ marginTop: 40 }} />
            : <Text style={styles.emptyText}>Nenhum lançamento encontrado.</Text>
        }
        renderItem={({ item: lote }) => {
          const totalLote = lote.movimentos.reduce((s, m) => s + m.quantidade, 0)
          const hora = format(new Date(lote.created_at), "dd/MM HH:mm")
          const isAbast = lote.tipo === "abastecimento"
          return (
            <TouchableOpacity
              style={styles.loteCard}
              onPress={() => abrirEditarLote(lote)}
              activeOpacity={0.75}>
              <View style={[styles.loteBadge, { backgroundColor: isAbast ? "#dbeafe" : "#fef3c7" }]}>
                <Ionicons
                  name={isAbast ? "arrow-down-circle" : "arrow-up-circle"}
                  size={22}
                  color={isAbast ? "#1d4ed8" : "#b45309"}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.loteDeposito}>{lote.deposito_nome}</Text>
                <Text style={styles.loteProdutos}>
                  {lote.movimentos.length} produto(s) · {totalLote} un.
                </Text>
                <Text style={styles.loteProdutosList} numberOfLines={1}>
                  {lote.movimentos.map(m => m.produto_nome).join(", ")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={[styles.loteTipoText, { color: isAbast ? "#1d4ed8" : "#b45309" }]}>
                  {isAbast ? "Abastec." : "Retirada"}
                </Text>
                <Text style={styles.loteHora}>{hora}</Text>
                <Ionicons name="chevron-forward" size={14} color="#cbd5e1" />
              </View>
            </TouchableOpacity>
          )
        }}
      />
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f1f5f9" }}>
      {/* Abas internas */}
      <View style={styles.tabBar}>
        {(["lancamento", "historico"] as const).map(aba => (
          <TouchableOpacity
            key={aba}
            style={[styles.tabBtn, abaAtiva === aba && styles.tabBtnActive]}
            onPress={() => setAbaAtiva(aba)}>
            <Ionicons
              name={aba === "lancamento" ? "add-circle-outline" : "time-outline"}
              size={16}
              color={abaAtiva === aba ? BLUE : "#94a3b8"} />
            <Text style={[styles.tabBtnText, abaAtiva === aba && styles.tabBtnTextActive]}>
              {aba === "lancamento" ? "Lançamento" : "Histórico"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {abaAtiva === "lancamento" ? renderLancamento() : renderHistorico()}

      {/* Modal de edição de lote */}
      <Modal
        visible={!!editLote}
        transparent
        animationType="slide"
        onRequestClose={() => setEditLote(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}>
          <View style={[styles.editModal, { maxHeight: "85%" }]}>
            {/* Cabeçalho */}
            <View style={styles.editModalHeader}>
              <View>
                <Text style={styles.editModalTitle}>Editar Lote</Text>
                {editLote && (
                  <Text style={styles.editModalDesc}>
                    {toPT(editLote.data_referencia)} · {editLote.tipo === "abastecimento" ? "Abastecimento" : "Retirada"}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setEditLote(null)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Depósito (aplica a todos) */}
            <Text style={styles.label}>Depósito</Text>
            <DepositoPicker
              depositos={depositos}
              value={editDeposito}
              onChange={setEditDeposito}
            />

            {/* Produtos do lote */}
            <ScrollView style={{ marginTop: 14 }} keyboardShouldPersistTaps="handled">
              {editLote?.movimentos.map(m => (
                <View key={m.id} style={styles.loteEditRow}>
                  <Text style={styles.loteEditProd} numberOfLines={2}>{m.produto_nome}</Text>
                  <Stepper
                    value={editQtds[m.id] ?? String(m.quantidade)}
                    onChange={v => setEditQtds(prev => ({ ...prev, [m.id]: v }))}
                  />
                </View>
              ))}
            </ScrollView>

            {/* Ações */}
            <View style={styles.editModalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditLote(null)} disabled={editSaving}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, editSaving && { opacity: 0.6 }]}
                onPress={salvarEdicaoLote}
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
    marginBottom: 4,
  },

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

  catHeader: {
    fontSize: 13, fontWeight: "700", color: "#475569",
    textTransform: "uppercase", letterSpacing: 0.5,
    marginBottom: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },

  prodRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
  },
  prodNome: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  prodMarca: { fontSize: 11, color: "#94a3b8", marginTop: 2 },

  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stepperBtn: {
    width: 32,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  qtdInput: {
    height: 40,
    borderWidth: 1.5,
    borderColor: "#93c5fd",
    borderRadius: 8,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 4,
    minWidth: 52,
  },

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
  resumoText: {
    fontSize: 11, color: "#94a3b8", textAlign: "center",
    marginTop: 8, fontStyle: "italic",
  },

  // Cards de lote no histórico
  loteCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  loteBadge: {
    width: 42, height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  loteDeposito: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  loteProdutos: { fontSize: 12, color: "#64748b", marginTop: 2 },
  loteProdutosList: { fontSize: 11, color: "#94a3b8", marginTop: 1, flexShrink: 1 },
  loteTipoText: { fontSize: 12, fontWeight: "700" },
  loteHora: { fontSize: 11, color: "#94a3b8" },

  loteEditRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  loteEditProd: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#1e293b",
    marginRight: 12,
  },

  emptyText: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },

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
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  editModalTitle: { fontSize: 17, fontWeight: "700", color: BLUE },
  editModalDesc: { fontSize: 12, color: "#64748b", marginTop: 2 },
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
