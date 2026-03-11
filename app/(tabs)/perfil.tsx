/**
 * app/(tabs)/perfil.tsx — Dados do usuário e alteração de senha
 */
import { useState } from "react"
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"

const BLUE = "#1e3a5f"

export default function PerfilScreen() {
  const { user, permissions, signOut } = useAuth()

  const [senhaAtual,   setSenhaAtual]   = useState("")
  const [novaSenha,    setNovaSenha]    = useState("")
  const [confirmaSenha, setConfirmaSenha] = useState("")
  const [salvandoSenha, setSalvandoSenha] = useState(false)
  const [mostrarSenha,  setMostrarSenha]  = useState(false)

  async function handleAlterarSenha() {
    if (!novaSenha || !confirmaSenha) {
      Alert.alert("Atenção", "Preencha a nova senha e a confirmação.")
      return
    }
    if (novaSenha.length < 6) {
      Alert.alert("Senha fraca", "A senha deve ter pelo menos 6 caracteres.")
      return
    }
    if (novaSenha !== confirmaSenha) {
      Alert.alert("Senhas diferentes", "A nova senha e a confirmação não conferem.")
      return
    }

    setSalvandoSenha(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha })
      if (error) throw error
      setSenhaAtual("")
      setNovaSenha("")
      setConfirmaSenha("")
      Alert.alert("✓ Senha Alterada", "Sua senha foi atualizada com sucesso!")
    } catch (e) {
      Alert.alert("Erro", (e as Error).message)
    } finally {
      setSalvandoSenha(false)
    }
  }

  const roleLabel: Record<string, string> = {
    administrador: "Administrador",
    operador:      "Operador",
    visualizador:  "Visualizador",
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Cabeçalho do perfil */}
      <View style={styles.avatarCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {user?.email?.charAt(0).toUpperCase() ?? "U"}
          </Text>
        </View>
        <Text style={styles.avatarEmail}>{user?.email ?? "—"}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>
            {roleLabel[permissions?.role ?? ""] ?? permissions?.role ?? "—"}
          </Text>
        </View>
      </View>

      {/* Informações da conta */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Informações da Conta</Text>

        <View style={styles.infoRow}>
          <Ionicons name="mail-outline" size={18} color="#64748b" />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.infoLabel}>E-mail</Text>
            <Text style={styles.infoValue}>{user?.email ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.separator} />

        <View style={styles.infoRow}>
          <Ionicons name="shield-checkmark-outline" size={18} color="#64748b" />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.infoLabel}>Perfil de acesso</Text>
            <Text style={styles.infoValue}>
              {roleLabel[permissions?.role ?? ""] ?? "—"}
            </Text>
          </View>
        </View>

        <View style={styles.separator} />

        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={18} color="#64748b" />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.infoLabel}>ID do usuário</Text>
            <Text style={[styles.infoValue, { fontSize: 11, color: "#94a3b8" }]}>
              {user?.id ?? "—"}
            </Text>
          </View>
        </View>
      </View>

      {/* Alterar senha */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Alterar Senha</Text>

        <Text style={styles.label}>Nova senha</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={novaSenha}
            onChangeText={setNovaSenha}
            placeholder="Mínimo 6 caracteres"
            secureTextEntry={!mostrarSenha}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setMostrarSenha(!mostrarSenha)}>
            <Ionicons
              name={mostrarSenha ? "eye-off-outline" : "eye-outline"}
              size={20} color="#64748b" />
          </TouchableOpacity>
        </View>

        <Text style={[styles.label, { marginTop: 12 }]}>Confirmar nova senha</Text>
        <TextInput
          style={styles.input}
          value={confirmaSenha}
          onChangeText={setConfirmaSenha}
          placeholder="Repita a nova senha"
          secureTextEntry={!mostrarSenha}
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.saveBtn, salvandoSenha && { opacity: 0.6 }]}
          onPress={handleAlterarSenha}
          disabled={salvandoSenha}
          activeOpacity={0.8}>
          {salvandoSenha
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name="lock-closed-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.saveBtnText}>Salvar nova senha</Text>
              </>
          }
        </TouchableOpacity>
      </View>

      {/* Sair */}
      <TouchableOpacity style={styles.sairBtn} onPress={signOut} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color="#dc2626" />
        <Text style={styles.sairBtnText}>Sair da conta</Text>
      </TouchableOpacity>

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },
  content:   { padding: 16, paddingBottom: 40 },

  // Avatar
  avatarCard: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: BLUE,
    alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  avatarLetter: { fontSize: 32, fontWeight: "700", color: "#fff" },
  avatarEmail:  { fontSize: 16, fontWeight: "600", color: "#1e293b", marginBottom: 8 },
  roleBadge: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 20,
  },
  roleText: { fontSize: 12, fontWeight: "700", color: BLUE },

  // Card genérico
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 15, fontWeight: "700", color: BLUE,
    marginBottom: 16,
  },

  // Info rows
  infoRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  infoLabel: { fontSize: 11, fontWeight: "600", color: "#94a3b8", marginBottom: 2 },
  infoValue: { fontSize: 14, color: "#1e293b" },
  separator: { height: 1, backgroundColor: "#f1f5f9", marginVertical: 10 },

  // Formulário de senha
  label: { fontSize: 12, fontWeight: "600", color: "#475569", marginBottom: 6 },
  inputRow: { flexDirection: "row", alignItems: "center" },
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
  eyeBtn: {
    marginLeft: 8,
    width: 44, height: 44,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#e2e8f0",
    borderRadius: 10, backgroundColor: "#f8fafc",
  },
  saveBtn: {
    flexDirection: "row",
    height: 50,
    backgroundColor: BLUE,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Botão sair
  sairBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  sairBtnText: { color: "#dc2626", fontSize: 15, fontWeight: "700" },
})
