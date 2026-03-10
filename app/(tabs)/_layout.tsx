/**
 * app/(tabs)/_layout.tsx — Bottom Tab Navigator
 *
 * Exibe apenas as abas permitidas para a role do usuário:
 *  - Abastecimento: qualquer usuário autenticado
 *  - Contagem:      apenas operador e administrador
 */
import { Tabs, Redirect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { TouchableOpacity, Text, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useAuth } from "@/context/AuthContext"

const BLUE = "#1e3a5f"
const GRAY = "#94a3b8"

export default function TabsLayout() {
  const { session, permissions, signOut } = useAuth()
  const insets = useSafeAreaInsets()

  // Segurança: nunca deve chegar aqui sem sessão (AuthGuard redireciona antes)
  if (!session) return <Redirect href="/(auth)/login" />

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: BLUE,
        tabBarInactiveTintColor: GRAY,
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#e2e8f0",
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          height: 60 + (insets.bottom > 0 ? insets.bottom : 8),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerStyle: {
          backgroundColor: BLUE,
        },
        headerTintColor: "#fff",
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 17,
        },
        headerRight: () => (
          <TouchableOpacity onPress={signOut} style={styles.headerBtn}>
            <Ionicons name="log-out-outline" size={22} color="#fff" />
          </TouchableOpacity>
        ),
      }}>

      {/* Módulo 1: Abastecimento / Retirada — todas as roles */}
      <Tabs.Screen
        name="abastecimento"
        options={{
          title: "Abastecimento",
          tabBarLabel: "Abastec.",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="swap-vertical-outline" color={color} size={size} />
          ),
        }}
      />

      {/* Módulo 2: Contagem — apenas operador/administrador */}
      <Tabs.Screen
        name="contagem"
        options={{
          title: "Contagem de Estoque",
          tabBarLabel: "Contagem",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" color={color} size={size} />
          ),
          // Oculta a aba para visualizadores
          href: permissions?.canContagem ? undefined : null,
        }}
      />

    </Tabs>
  )
}

const styles = StyleSheet.create({
  headerBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
})
