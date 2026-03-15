/**
 * app/(tabs)/home.tsx — Tela inicial do app
 *
 * - Filtro de depósito no topo (auto-seleciona se usuário tem só um)
 * - Valor total de faltas no depósito
 * - Se sem faltas: mensagem de parabéns com ícone joinha
 * - Relatório de faltas: data, produto, quantidade
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, FlatList, Modal, RefreshControl,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { format } from "date-fns"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import { onSync } from "@/lib/syncEvent"
import type { Deposito } from "@/lib/types"

const BLUE = "#1e3a5f"
const GRAY = "#94a3b8"

interface FaltaItem {
  data_referencia: string
  produto_id: string
  produto_nome: string
  produto_categoria: string
  diferenca: number
  preco: number
}

export default function HomeScreen() {
  const { user, permissions } = useAuth()
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [depositoId, setDepositoId] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [faltas, setFaltas] = useState<FaltaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Carrega depósitos do usuário
  useEffect(() => {
    if (!permissions) return
    supabase.from("depositos")
      .select("id, nome, tipo_deposito, ativo")
      .eq("ativo", true).order("nome")
      .then(({ data: deps }) => {
        if (!deps) return
        const editIds = permissions.deposito_edit_ids ?? []
        const viewIds = permissions.deposito_ids ?? []
        let allowed = deps as Deposito[]
        if (!permissions.isAdmin) {
          // Mostra depósitos de visualização OU edição
          const allIds = [...new Set([...editIds, ...viewIds])]
          if (allIds.length > 0) {
            allowed = allowed.filter(d => allIds.includes(d.id))
          }
        }
        setDepositos(allowed)
        // Auto-seleciona se tem só um depósito
        if (allowed.length === 1) setDepositoId(allowed[0].id)
        else if (allowed.length > 0 && !depositoId) setDepositoId(allowed[0].id)
      })
  }, [permissions])

  // Busca faltas do depósito selecionado (últimos 30 dias)
  const carregarFaltas = useCallback(async () => {
    if (!depositoId) return
    setLoading(true)
    try {
      const hoje = format(new Date(), "yyyy-MM-dd")
      const trintaDiasAtras = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd")

      // Busca faltas e preços em paralelo
      const [faltasRes, produtosRes] = await Promise.all([
        supabase
          .from("vw_estoque_calculado")
          .select("data_referencia, produto_id, produto_nome, produto_categoria, diferenca")
          .eq("deposito_id", depositoId)
          .gte("data_referencia", trintaDiasAtras)
          .lte("data_referencia", hoje)
          .lt("diferenca", 0)
          .order("data_referencia", { ascending: false }),
        supabase
          .from("produtos")
          .select("id, preco")
          .eq("ativo", true),
      ])

      if (faltasRes.error) throw faltasRes.error

      // Mapa de preços por produto_id
      const precoMap: Record<string, number> = {}
      for (const p of produtosRes.data ?? []) {
        precoMap[p.id] = parseFloat(p.preco) || 0
      }

      setFaltas((faltasRes.data ?? []).map((r: any) => ({
        data_referencia: r.data_referencia,
        produto_id: r.produto_id,
        produto_nome: r.produto_nome,
        produto_categoria: r.produto_categoria,
        diferenca: r.diferenca,
        preco: precoMap[r.produto_id] ?? 0,
      })))
    } catch (e) {
      console.error("Erro ao carregar faltas:", e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [depositoId])

  useEffect(() => { carregarFaltas() }, [carregarFaltas])
  useEffect(() => onSync(carregarFaltas), [carregarFaltas])

  const depositoSelecionado = depositos.find(d => d.id === depositoId)
  const totalFaltas = faltas.reduce((acc, f) => acc + Math.abs(f.diferenca), 0)
  const totalValor = faltas.reduce((acc, f) => acc + Math.abs(f.diferenca) * f.preco, 0)
  const semFaltas = totalFaltas === 0

  /** Formata número como moeda brasileira */
  const fmtBRL = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

  return (
    <View style={st.container}>
      {/* Seletor de depósito */}
      <View style={st.filterCard}>
        <Text style={st.filterLabel}>Depósito</Text>
        <TouchableOpacity style={st.picker} onPress={() => setPickerOpen(true)} activeOpacity={0.7}>
          <Ionicons name="business-outline" size={18} color={BLUE} />
          <Text style={st.pickerText} numberOfLines={1}>
            {depositoSelecionado?.nome ?? "Selecione o depósito"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={GRAY} />
        </TouchableOpacity>
      </View>

      {/* Conteúdo */}
      {!depositoId ? (
        <View style={st.emptyContainer}>
          <Ionicons name="arrow-up-outline" size={40} color={GRAY} />
          <Text style={st.emptyText}>Selecione um depósito acima</Text>
        </View>
      ) : loading && !refreshing ? (
        <View style={st.emptyContainer}>
          <ActivityIndicator size="large" color={BLUE} />
          <Text style={{ color: GRAY, marginTop: 12 }}>Carregando...</Text>
        </View>
      ) : (
        <FlatList
          data={faltas}
          keyExtractor={(item, idx) => `${item.data_referencia}-${item.produto_id}-${idx}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); carregarFaltas() }} />
          }
          ListHeaderComponent={
            <View style={st.resumoCard}>
              {semFaltas ? (
                /* Sem faltas — parabéns */
                <View style={st.semFaltaContainer}>
                  <View style={st.joinha}>
                    <Ionicons name="thumbs-up" size={48} color="#16a34a" />
                  </View>
                  <Text style={st.parabensTitulo}>Sem Faltas!</Text>
                  <Text style={st.parabensTexto}>
                    Parabéns! Seu depósito não tem nenhuma falta nos últimos 30 dias.
                  </Text>
                </View>
              ) : (
                /* Com faltas — resumo com valor em R$ */
                <View>
                  <View style={st.faltaResumoRow}>
                    <Ionicons name="alert-circle" size={28} color="#dc2626" />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                      <Text style={st.faltaResumoLabel}>Total de Faltas</Text>
                      <Text style={st.faltaResumoValor}>{fmtBRL(totalValor)}</Text>
                    </View>
                  </View>
                  <Text style={st.faltaSubtexto}>
                    {totalFaltas} unidade(s) em {faltas.length} produto(s) nos últimos 30 dias
                  </Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            semFaltas ? null : (
              <Text style={st.emptyText}>Nenhuma falta encontrada.</Text>
            )
          }
          renderItem={({ item }) => (
            <View style={st.faltaRow}>
              <View style={st.faltaIconContainer}>
                <Ionicons name="warning-outline" size={18} color="#dc2626" />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={st.faltaProduto}>{item.produto_nome}</Text>
                <Text style={st.faltaCategoria}>{item.produto_categoria}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={st.faltaQtd}>{Math.abs(item.diferenca)}</Text>
                <Text style={st.faltaData}>
                  {format(new Date(item.data_referencia + "T12:00:00"), "dd/MM/yyyy")}
                </Text>
              </View>
            </View>
          )}
        />
      )}

      {/* Modal picker de depósito */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={st.overlay} onPress={() => setPickerOpen(false)} activeOpacity={1}>
          <View style={st.pickerModal}>
            <Text style={st.pickerModalTitle}>Selecione o Depósito</Text>
            <FlatList
              data={depositos}
              keyExtractor={d => d.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[st.pickerItem, item.id === depositoId && st.pickerItemActive]}
                  onPress={() => { setDepositoId(item.id); setPickerOpen(false) }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.pickerItemText, item.id === depositoId && st.pickerItemTextActive]}>
                      {item.nome}
                    </Text>
                    <Text style={[st.pickerItemSub, item.id === depositoId && { color: "rgba(255,255,255,0.7)" }]}>
                      {item.tipo_deposito === "movel" ? "Móvel" : "Físico"}
                    </Text>
                  </View>
                  {item.id === depositoId && <Ionicons name="checkmark" size={18} color="#fff" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },

  filterCard: {
    backgroundColor: "#fff",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#e2e8f0",
  },
  filterLabel: { fontSize: 12, fontWeight: "600", color: "#475569", marginBottom: 6 },
  picker: {
    height: 48, flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 12,
    paddingHorizontal: 14, backgroundColor: "#f8fafc",
  },
  pickerText: { flex: 1, fontSize: 15, color: "#1e293b", fontWeight: "500" },

  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { textAlign: "center", color: GRAY, marginTop: 12, fontSize: 14 },

  // Resumo
  resumoCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 20,
    marginBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  semFaltaContainer: { alignItems: "center", paddingVertical: 10 },
  joinha: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: "#dcfce7",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  parabensTitulo: { fontSize: 22, fontWeight: "800", color: "#16a34a", marginBottom: 6 },
  parabensTexto: { fontSize: 14, color: "#4b5563", textAlign: "center", lineHeight: 20 },

  faltaResumoRow: { flexDirection: "row", alignItems: "center" },
  faltaResumoLabel: { fontSize: 13, color: "#6b7280", fontWeight: "500" },
  faltaResumoValor: { fontSize: 26, fontWeight: "800", color: "#dc2626", marginTop: 2 },
  faltaSubtexto: { fontSize: 12, color: GRAY, marginTop: 10 },

  // Lista de faltas
  faltaRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 12, padding: 14,
    marginBottom: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  faltaIconContainer: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "#fef2f2",
    alignItems: "center", justifyContent: "center",
  },
  faltaProduto: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  faltaCategoria: { fontSize: 11, color: GRAY, marginTop: 1 },
  faltaQtd: { fontSize: 16, fontWeight: "800", color: "#dc2626" },
  faltaData: { fontSize: 11, color: GRAY, marginTop: 2 },

  // Modal
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  pickerModal: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, maxHeight: "60%",
  },
  pickerModalTitle: {
    fontSize: 16, fontWeight: "700", color: BLUE,
    marginBottom: 12, textAlign: "center",
  },
  pickerItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 10, marginBottom: 4,
  },
  pickerItemActive: { backgroundColor: BLUE },
  pickerItemText: { fontSize: 15, color: "#1e293b" },
  pickerItemTextActive: { color: "#fff", fontWeight: "700" },
  pickerItemSub: { fontSize: 11, color: GRAY, marginTop: 1 },
})
