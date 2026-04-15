import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import NavBar from './components/NavBar'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TtsPage from './pages/TtsPage'
import VoicesPage from './pages/VoicesPage'
import ChatPage from './pages/ChatPage'
import StudioPage from './pages/StudioPage'
import NotFoundPage from './pages/NotFoundPage'
import './App.css'

export default function App() {
  const { user } = useAuth()

  return (
    <>
      {user && <NavBar />}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tts"
          element={
            <ProtectedRoute>
              <TtsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/voices"
          element={
            <ProtectedRoute>
              <VoicesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/studio"
          element={
            <ProtectedRoute adminOnly>
              <StudioPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}
