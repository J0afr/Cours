# 📚 Cours – application de révision

Application web (HTML/JS, aucune dépendance) pour réviser tes cours avec :
fiche de synthèse, **QCM** (réponse unique ou multiple, explications), **cartes mémoire**,
**mode examen**, **répétition espacée** (système de Leitner) et statistiques par chapitre.
La progression est sauvegardée dans ton navigateur.

## Lancer
```bash
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
```
Ou activer **GitHub Pages** sur le dépôt pour l'utiliser sur téléphone.

## Ajouter un cours
1. Envoie le cours (texte, extraits, PDF…) à Claude dans le chat.
2. Claude génère `courses/<id>.json` et l'ajoute à `courses/index.json`.
3. (Ou) colle/importe un JSON depuis la page d'accueil : il reste dans ton navigateur.

## Format d'un cours
```json
{
  "id": "mon-cours", "title": "Titre", "description": "optionnel",
  "summary": [{ "title": "Partie 1", "points": ["**Notion** à retenir", "…"] }],
  "flashcards": [{ "q": "Question", "a": "Réponse", "chapter": "Partie 1" }],
  "questions": [{
    "chapter": "Partie 1",
    "question": "Énoncé ?",
    "choices": ["A", "B", "C", "D"],
    "answer": [1],
    "explanation": "Pourquoi B est correct."
  }]
}
```
`answer` = indices des bonnes réponses (plusieurs indices → QCM à réponses multiples).
Markdown léger accepté : `**gras**`, `*italique*`, `` `code` ``.
