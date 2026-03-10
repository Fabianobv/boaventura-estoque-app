/**
 * app/(tabs)/contagem.tsx — Módulo 2: Contagem de Estoque
 *
 * Regras de negócio:
 *  - Apenas uma contagem por dia/depósito
 *  - Se já existe contagem de outro usuário:
 *      → opções: Validar (confirmar) ou Editar (alterar valores)
 *  - Usuário só pode iniciar contagem nova se não existir nenhuma
 *  - Requer role operador ou administrador (aba oculta para visualizador)
 */
import { useCallback, useEffect, useState } from "react"
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, FlatList,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import type { Deposito, Produto, EstoqueLinha } from "@/lib/types"

// ─── Tipos locais ──────────────────────────────────────────────────
type StatusContagem = "nova" | "minha" | "outro_usuario" | "validada"

interface ItemContagem {
  produto_id:     string
  produto_nome:   string
  produto_categ:  string
  saldo_calculado: number  // saldo_do_dia da view
  contagem_final: number   // o que foi contado
  avariado:       number
  diferenca:      number
}

// ─── Tela principal ────────────────────────────────────────────────
export default function ContagemScreen() {
  const { user } = useAuth()

  const [data,       setData]       = useState(format(new Date(), "yyyy-MM-dd"))
  const [depositoId, setDepositoId] = useState("")
  const [depositos,  setDepositos]  = useState<Deposito[]>([])

  // Estado da contagem
  const [status,  setStatus]  = useState<StatusContagem>("nova")
  const [itens,   setItens]   = useState<ItemContagem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Responsável pela contagem existente
  const [responsavel, setResponsavel] = useState<string | null>(null)

  // ── Carregamento inicial de depósitos ────────────────────────────
  useEffect(() => {
    supabase.from("depositos")
      .select("id, nome, ativo")
      .eq("ativo", true)
      .order("nome")
      .then(({ data: deps }) => {
        if (deps) {
          setDepositos(deps as Deposito[])
          if (deps.length > 0) setDepositoId(deps[0].id)
        }
      })
  }, [])

  // ── Carrega estado da contagem do dia ────────────────────────────
  const carregarContagem = useCallback(async () => {
    if (!depositoId || !data) return
    setLoading(true)
    try {
      // Inicializa dia (garante linhas existem)
      await supabase.rpc("inicializar_lancamento_diario", {
        p_data: data,
        p_deposito_id: depositoId,
      })

      // Busca linhas via view (inclui saldo calculado e contagem atual)
      const { data: rows, error } = await supabase
        .from("vw_estoque_calculado")
        .select([
          "produto_id", "produto_nome", "produto_categoria",
          "saldo_do_dia", "contagem_final", "avariado", "diferenca",
          "updated_by",
        ].join(","))
        .eq("data_referencia", data)
        .eq("deposito_id", depositoId)
        .eq("is_vasilhame", false)   // vasilhames não entram na contagem manual
        .order("produto_nome")

      if (error) throw error

      const linhas = (rows ?? []) as (EstoqueLinha & {
        produto_categoria: string; saldo_do_dia: number; diferenca: number; updated_by: string | null
      })[]

      // Detecta se já existe contagem (alguém preencheu contagem_final > 0)
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
          // Busca o nome do responsável
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

      setItens(linhas.map(l => ({
        produto_id:      l.produto_id!,
        produto_nome:    l.produto_nome!,
        produto_categ:   l.produto_categoria,
        saldo_calculado: l.saldo_do_dia ?? 0,
        contagem_final:  l.contagem_final,
        avariado:        l.avariado,
        diferenca:       l.diferenca ?? 0,
      })))
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [data, depositoId, user?.id])

  useEffect(() => { carregarContagem() }, [carregarContagem])

  // ── Atualiza um item localmente ──────────────────────────────────
  function updateItem(produtoId: string, campo: "contagem_final" | "avariado", valor: number) {
    setItens(prev => prev.map(it => {
      if (it.produto_id !== produtoId) return it
      const novo = { ...it, [campo]: valor }
      // Recalcula diferença reativamente
      novo.diferenca = (novo.contagem_final + novo.avariado) - novo.saldo_calculado
      return novo
    }))
  }

  // ── Salvar contagem ──────────────────────────────────────────────
  async function handleSalvar() {
    setSaving(true)
    try {
      // Upsert em batch: todos os itens de uma vez
      const upserts = itens.map(it => ({
        data_referencia: data,
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

  // ── Validar (confirmar contagem de outro usuário) ─────────────────
  function handleValidar() {
    Alert.alert(
      "Validar Contagem",
      `Confirma que a contagem feita por ${responsavel ?? "outro usuário"} está correta?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: async () => {
            setSaving(true)
            // "Validar" significa atribuir ao usuário atual (updated_by = eu)
            const { error } = await supabase
              .from("estoque_diario")
              .update({ updated_by: user?.id })
              .eq("data_referencia", data)
              .eq("deposito_id", depositoId)
            setSaving(false)
            if (error) { Alert.alert("Erro", error.message); return }
            setStatus("minha")
            Alert.alert("✓ Validado", "Contagem confirmada por você.")
          },
        },
      ]
    )
  }

  // ── Renderização de um item ──────────────────────────────────────
  function renderItem({ item }: { item: ItemContagem }) {
    const canEdit = status === "nova" || status === "minha"
    const difColor = item.diferenca < 0 ? "#dc2626" : item.diferenca > 0 ? "#d97706" : "#16a34a"

    return (
      <View style={styles.item}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemNome}>{item.produto_nome}</Text>
          <Text style={styles.itemCateg}>{item.produto_categ}</Text>
        </View>
        <View style={styles.itemRow}>
          <View style={styles.itemCol}>
            <Text style={styles.itemLabel}>Saldo Sistema</Text>
            <Text style={styles.itemValorNeutro}>{item.saldo_calculado}</Text>
          </View>
          <View style={styles.itemCol}>
            <Text style={styles.itemLabel}>Contagem</Text>
            {canEdit ? (
              <TextInput
                style={styles.itemInput}
                value={String(item.contagem_final)}
                onChangeText={v => updateItem(item.produto_id, "contagem_final", Math.max(0, parseInt(v || "0", 10)))}
                keyboardType="number-pad"
                selectTextOnFocus
              />
            ) : (
              <Text style={styles.itemValorNeutro}>{item.contagem_final}</Text>
            )}
          </View>
          <View style={styles.itemCol}>
            <Text style={styles.itemLabel}>Avariado</Text>
            {canEdit ? (
              <TextInput
                style={styles.itemInput}
                value={String(item.avariado)}
                onChangeText={v => updateItem(item.produto_id, "avariado", Math.max(0, parseInt(v || "0", 10)))}
                keyboardType="number-pad"
                selectTextOnFocus
              />
            ) : (
              <Text style={styles.itemValorNeutro}>{item.avariado}</Text>
            )}
          </View>
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
      {/* Controles de data e depósito */}
      <View style={styles.controls}>
        <View style={styles.controlItem}>
          <Text style={styles.controlLabel}>Data</Text>
          <TextInput
            style={styles.controlInput}
            value={data}
            onChangeText={setData}
            placeholder="AAAA-MM-DD"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={[styles.controlItem, { flex: 2 }]}>
          <Text style={styles.controlLabel}>Depósito</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {depositos.map(d => (
              <TouchableOpacity key={d.id} onPress={() => setDepositoId(d.id)}
                style={[styles.chip, depositoId === d.id && styles.chipActive]}>
                <Text style={[styles.chipText, depositoId === d.id && styles.chipTextActive]}>
                  {d.nome}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      {/* Banner de status */}
      {status === "outro_usuario" && (
        <View style={styles.bannerAviso}>
          <Ionicons name="warning-outline" size={16} color="#92400e" />
          <Text style={styles.bannerText}>
            Contagem já iniciada por <Text style={{ fontWeight: "700" }}>{responsavel}</Text>.
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

      {/* Lista de itens */}
      {loading ? (
        <ActivityIndicator color="#1e3a5f" style={{ flex: 1, marginTop: 40 }} />
      ) : (
        <FlatList
          data={itens}
          keyExtractor={i => i.produto_id}
          renderItem={renderItem}
          contentContainerStyle={styles.lista}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => {
              setRefreshing(true)
              carregarContagem()
            }} />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>Nenhum produto encontrado.</Text>
          }
        />
      )}

      {/* Botões de ação */}
      {!loading && itens.length > 0 && (
        <View style={styles.footer}>
          {status === "outro_usuario" ? (
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerBtnValidar]}
                onPress={handleValidar}
                disabled={saving}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                <Text style={styles.footerBtnText}>Validar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerBtnEditar]}
                onPress={() => setStatus("minha")}
                disabled={saving}>
                <Ionicons name="create-outline" size={18} color="#fff" />
                <Text style={styles.footerBtnText}>Editar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnSalvar, saving && { opacity: 0.6 }]}
              onPress={handleSalvar}
              disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Ionicons name="save-outline" size={18} color="#fff" />
                    <Text style={styles.footerBtnText}>
                      {status === "minha" ? "Atualizar Contagem" : "Salvar Contagem"}
                    </Text>
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
  container:    { flex: 1, backgroundColor: "#f1f5f9" },
  controls: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  controlItem:  { flex: 1 },
  controlLabel: { fontSize: 11, fontWeight: "600", color: "#475569", marginBottom: 4 },
  controlInput: {
    height: 36,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: "#1e293b",
    backgroundColor: "#f8fafc",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    marginRight: 6,
    backgroundColor: "#f8fafc",
  },
  chipActive:     { backgroundColor: BLUE, borderColor: BLUE },
  chipText:       { fontSize: 12, color: "#475569", fontWeight: "500" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  bannerAviso: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fef3c7",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#fde68a",
  },
  bannerOk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#bbf7d0",
  },
  bannerText: { fontSize: 13, color: "#92400e" },
  lista:      { padding: 12, paddingBottom: 100 },
  emptyText:  { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  item: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  itemHeader:     { marginBottom: 10 },
  itemNome:       { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  itemCateg:      { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  itemRow:        { flexDirection: "row", gap: 8 },
  itemCol:        { flex: 1, alignItems: "center" },
  itemLabel:      { fontSize: 10, fontWeight: "600", color: "#94a3b8", marginBottom: 4, textTransform: "uppercase" },
  itemValorNeutro:{ fontSize: 18, fontWeight: "700", color: "#334155" },
  itemValorDif:   { fontSize: 18, fontWeight: "700" },
  itemInput: {
    height: 40,
    width: "100%",
    borderWidth: 1.5,
    borderColor: "#93c5fd",
    borderRadius: 8,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: "#1e293b",
    backgroundColor: "#eff6ff",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  footerRow:        { flexDirection: "row", gap: 10 },
  footerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
  },
  footerBtnSalvar:  { backgroundColor: BLUE },
  footerBtnValidar: { backgroundColor: "#16a34a" },
  footerBtnEditar:  { backgroundColor: "#d97706" },
  footerBtnText:    { color: "#fff", fontSize: 15, fontWeight: "700" },
})
