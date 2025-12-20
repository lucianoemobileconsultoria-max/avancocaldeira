# Regras de Segurança do Firestore

Para configurar as regras de segurança no Firebase Console:

1. Acesse: https://console.firebase.google.com/
2. Selecione seu projeto "avancos"
3. Vá em "Firestore Database" no menu lateral
4. Clique na aba "Regras" (Rules)
5. Cole as regras abaixo e clique em "Publicar" (Publish)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permitir que usuários autenticados leiam/escrevam apenas seus próprios dados
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // Subcoleção de progresso de atividades
      match /progress/{progressId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
    
    // Bloquear acesso a qualquer outra coleção
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Explicação das Regras

- **Autenticação obrigatória**: Apenas usuários autenticados podem acessar dados
- **Dados privados**: Cada usuário só pode ler/escrever seus próprios dados
- **Estrutura**: 
  - `users/{userId}/` - Documento do usuário (contém activities e lastUpdated)
  - `users/{userId}/progress/{activityKey}` - Progresso de cada atividade
- **Segurança**: Outros usuários não podem ver ou modificar dados alheios

## Estrutura de Dados no Firestore

Após a atualização, seus dados ficarão organizados assim:

```
users/
└── {userId}/
    ├── activities: [array de atividades]
    ├── lastUpdated: timestamp
    └── progress/
        ├── {uniqueKey1}: { progress: 75 }
        ├── {uniqueKey2}: { progress: 50 }
        └── ...
```

**Atividades** agora são salvas no documento principal do usuário!
**Progressos** continuam na subcoleção `progress`.
