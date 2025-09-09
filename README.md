# AI Powered Query Companion

An AI-driven SQL query comparison and analysis tool powered by **xAI** and **Azure OpenAI**.  
It highlights differences between SQL queries, groups changes intelligently, and provides natural-language explanations tailored for both **developers** and **stakeholders**.

> 🔍 Compare. Analyze. Understand.

---

## 🔴 Demo

<img src="demo.gif" alt="AI Query Companion Demo" width="100%"/>

> 🎥 Coming soon: 

---

## ✨ Features

- 🔄 **Dual AI Model Support** – Switch between xAI and Azure OpenAI (GPT-4o) for analysis
- 🧠 **Query Comparison Engine** – Highlights **additions, deletions, modifications**
- 📊 **Change Grouping** – Groups nested subqueries and related changes intelligently
- 📝 **AI-Powered Explanations** – Explains changes with business use case, syntax, and performance insights
- 🧑‍💼 **Summary Generator** – Switch between **stakeholder** and **developer** summaries
- 🎨 **Modern UI/UX** – 
  - Sync scroll  
  - Dark/light mode  
  - Sound toggle  
  - Change filters (Add / Modify / Delete)
  - Jump-to-change functionality

---

## 🧰 Tech Stack

- **Frontend**: React (Next.js 14), Tailwind CSS
- **Backend**: Node.js (Next.js API Routes)
- **AI Providers**: 
  - xAI (Grok-4) 
  - Azure OpenAI 
- **Diff Engine**: LCS-based canonical SQL differ
- **Language**: TypeScript

---

## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/your-username/query-companion.git

# Install dependencies
cd query-companion
npm install

# Add environment variables
cp .env.example .env.local
# Fill in your API keys for xAI and Azure OpenAI

# Run the development server
npm run dev
