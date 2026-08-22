import React, { useState, useEffect, useRef } from 'react';
import {
  Users, MessageSquare, Activity, AlertTriangle, Send,
  CheckCircle, Loader2, Play, Settings2, BarChart3,
  Globe, FileText, Smartphone, Link, Upload, X, File, Info, Plus
} from 'lucide-react';

// --- API & Utility Functions ---

const extractJSON = (text) => {
  try {
    const regex = new RegExp('`{3}(?:json)?\\s*([\\s\\S]*?)\\s*`{3}');
    const match = text.match(regex);
    if (match) return JSON.parse(match[1]);
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON:", text);
    throw new Error("Failed to parse AI response as JSON.");
  }
};

const callGemini = async (prompt, systemInstruction) => {
  const maxRetries = 3;
  let delay = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, systemInstruction }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.text;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }
};

// --- Main Application Component ---

export default function SwarmSimulator() {
  const [currentView, setCurrentView] = useState('simulator');
  const [scenario, setScenario] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef(null);

  const [customPresets, setCustomPresets] = useState([]);
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [newPresetText, setNewPresetText] = useState("");

  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [personas, setPersonas] = useState([]);
  const [feed, setFeed] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [currentRound, setCurrentRound] = useState(0);

  const feedEndRef = useRef(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop().toLowerCase();
    let content = "";

    if (['txt', 'md', 'csv', 'json'].includes(fileExt)) {
      content = await file.text();
    } else if (['pdf', 'docx'].includes(fileExt)) {
      setUploadingFile(true);
      try {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(file);
        });

        const response = await fetch('/api/parse-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileData: base64 }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to parse document');
        }

        const data = await response.json();
        content = data.text;

        if (data.warning) {
          setAttachment({ type: 'file', name: file.name, data: content, warning: data.warning });
          setUploadingFile(false);
          e.target.value = null;
          return;
        }
      } catch (err) {
        setErrorMsg(`File upload error: ${err.message}`);
        setUploadingFile(false);
        e.target.value = null;
        return;
      }
      setUploadingFile(false);
    } else {
      content = `[Attached File: ${file.name}]`;
    }

    setAttachment({ type: 'file', name: file.name, data: content });
    e.target.value = null;
  };

  const handleAddLink = () => {
    if (!linkUrl.trim()) return;
    setAttachment({ type: 'link', name: linkUrl, data: linkUrl });
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const handleSaveCustomPreset = () => {
    if (!newPresetLabel.trim() || !newPresetText.trim()) return;
    setCustomPresets([...customPresets, {
      icon: <Activity size={16} />,
      label: newPresetLabel,
      text: newPresetText
    }]);
    setNewPresetLabel("");
    setNewPresetText("");
    setIsCreatingPreset(false);
  };

  const presets = [
    {
      icon: <FileText size={16} />,
      label: "Research Paper",
      text: "Publishing a new AI research paper claiming a 40% efficiency increase in training LLMs using a novel pruning method, but the methodology skips standard benchmarks."
    },
    {
      icon: <Globe size={16} />,
      label: "Netlify Launch",
      text: "Deploying a massive redesign and a 20% price hike to our SaaS Netlify app. Current users are grandfathered in for 6 months, but new features are locked behind the new tier."
    },
    {
      icon: <Smartphone size={16} />,
      label: "Social Media Post",
      text: "Posting a controversial thread on X/Twitter arguing that 'Prompt Engineering is a dead skill and will be obsolete in 6 months due to agentic frameworks.'"
    }
  ];

  const isInputDisabled = status !== "idle" && status !== "complete" && status !== "error";

  const runSimulation = async () => {
    if (!scenario.trim() && !attachment) return;

    setPersonas([]);
    setFeed([]);
    setAnalytics(null);
    setErrorMsg("");
    setCurrentRound(0);

    const combinedScenario = `${scenario}${attachment ? `\n\n[Context attached by user via ${attachment.type}: ${attachment.name}]\n${attachment.data}` : ''}`;

    try {
      // PHASE 1: GENERATE PERSONAS
      setStatus("generating_personas");

      const personaSystemPrompt = `You are an AI generating a cast of simulation agents. The user wants to simulate public reaction to a specific scenario involving research, web launches, or social media.
      Generate 5 distinct personas who represent different demographics, biases, and internet archetypes (e.g., Skeptical Academic, Fanboy, Angry Customer, Nuanced Journalist, Troll).
      Return ONLY a valid JSON object matching this schema:
      {
        "personas": [
          {
            "id": "p1",
            "name": "String (e.g., Dr. Aris)",
            "role": "String (e.g., Skeptical ML Researcher)",
            "bias": "String (brief description of their worldview/bias)",
            "avatarColor": "String (a tailwind color class like 'bg-red-500' or 'bg-blue-500')"
          }
        ]
      }`;

      const personaRes = await callGemini(`Scenario to react to: "${combinedScenario}"`, personaSystemPrompt);
      const generatedPersonas = extractJSON(personaRes).personas;
      setPersonas(generatedPersonas);

      // PHASE 2: SIMULATE DISCUSSION ROUNDS
      setStatus("simulating");
      let currentFeed = [];
      const totalRounds = 3;

      for (let round = 1; round <= totalRounds; round++) {
        setCurrentRound(round);

        const discussionSystemPrompt = `You are simulating a social network/forum discussion.
        Scenario: "${combinedScenario}"
        Personas available: ${JSON.stringify(generatedPersonas)}
        Previous messages in the thread: ${JSON.stringify(currentFeed)}

        Generate the next round of discussion. Each persona should post exactly one message reacting to the scenario OR replying to previous messages. They MUST act according to their bias.
        Return ONLY a valid JSON object matching this schema:
        {
          "messages": [
            {
              "personaId": "String (must match an id from the personas list)",
              "text": "String (the content of their post/comment)",
              "sentiment": "Number (from -1.0 for extremely negative to 1.0 for extremely positive)"
            }
          ]
        }`;

        const discussionRes = await callGemini(`Generate Round ${round} of the discussion.`, discussionSystemPrompt);
        const newMessages = extractJSON(discussionRes).messages.map(msg => ({
          ...msg,
          round,
          id: crypto.randomUUID()
        }));

        currentFeed = [...currentFeed, ...newMessages];
        setFeed(currentFeed);
      }

      // PHASE 3: SUMMARIZE & PREDICT
      setStatus("summarizing");

      const summarySystemPrompt = `You are a social dynamics analyst. Review the following simulation of people reacting to a scenario.
      Scenario: "${combinedScenario}"
      Discussion Log: ${JSON.stringify(currentFeed)}

      Provide a predictive report on what would happen in the real world.
      Return ONLY a valid JSON object matching this schema:
      {
        "prediction": {
          "overallSentiment": "String (Positive, Negative, Mixed, Highly Polarized)",
          "keyRisk": "String (The biggest point of failure or backlash)",
          "actionableAdvice": "String (One specific thing the user should change before doing this)",
          "predictedOutcome": "String (A 2-3 sentence prediction of the real-world result)"
        }
      }`;

      const summaryRes = await callGemini(`Analyze the simulation and provide the predictive report.`, summarySystemPrompt);
      const predictionData = extractJSON(summaryRes).prediction;
      setAnalytics(predictionData);

      setStatus("complete");

    } catch (error) {
      console.error(error);
      setErrorMsg(error.message || "An error occurred during the simulation.");
      setStatus("error");
    }
  };

  const calculateAverageSentiment = () => {
    if (feed.length === 0) return 0;
    const sum = feed.reduce((acc, msg) => acc + msg.sentiment, 0);
    return (sum / feed.length).toFixed(2);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-4 md:p-8 flex flex-col">

      {/* Header */}
      <header className="mb-8 border-b border-slate-800 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Activity className="text-emerald-400 w-8 h-8" />
            <h1 className="text-3xl font-bold text-white tracking-tight">SwarmDynamics</h1>
          </div>
          <p className="text-slate-400 max-w-2xl">
            Simulate public reactions, faction dynamics, and sentiment shifts before you publish research, deploy to Netlify, or post on social media.
          </p>
        </div>

        <nav className="flex gap-2">
          <button
            onClick={() => setCurrentView('simulator')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentView === 'simulator' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            Simulator
          </button>
          <button
            onClick={() => setCurrentView('about')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentView === 'about' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <Info size={16} /> About
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow">
        {currentView === 'simulator' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Left Column: Input & Setup */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
                  <Settings2 size={20} className="text-blue-400" />
                  Scenario Configuration
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      What are you about to do?
                    </label>
                    <textarea
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none h-32"
                      placeholder="Describe your launch, publication, or announcement..."
                      value={scenario}
                      onChange={(e) => setScenario(e.target.value)}
                      disabled={isInputDisabled}
                    />

                    {/* Attachment UI */}
                    <div className="mt-3">
                      {uploadingFile ? (
                        <div className="flex items-center gap-3 bg-slate-800 rounded-lg p-3 border border-slate-700">
                          <Loader2 size={18} className="text-blue-400 animate-spin" />
                          <span className="text-sm text-slate-300">Extracting document text...</span>
                        </div>
                      ) : attachment ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between bg-slate-800 rounded-lg p-3 border border-slate-700">
                            <div className="flex items-center gap-3 overflow-hidden">
                              {attachment.type === 'link' ? <Link size={18} className="text-blue-400 shrink-0" /> : <File size={18} className="text-purple-400 shrink-0" />}
                              <span className="text-sm text-slate-300 truncate">{attachment.name}</span>
                            </div>
                            <button onClick={() => setAttachment(null)} className="text-slate-500 hover:text-slate-300 p-1">
                              <X size={16} />
                            </button>
                          </div>
                          {attachment.warning && (
                            <p className="text-xs text-amber-400 flex items-center gap-1 mt-1">
                              <AlertTriangle size={12} /> {attachment.warning}
                            </p>
                          )}
                        </div>
                      ) : showLinkInput ? (
                        <div className="flex gap-2">
                          <input
                            type="url"
                            placeholder="https://..."
                            className="flex-grow bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-200"
                            value={linkUrl}
                            onChange={(e) => setLinkUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddLink()}
                          />
                          <button onClick={handleAddLink} className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded-lg text-sm transition-colors">Add</button>
                          <button onClick={() => setShowLinkInput(false)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 rounded-lg text-sm transition-colors">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowLinkInput(true)}
                            disabled={isInputDisabled}
                            className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-blue-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Link size={14} /> Attach Link
                          </button>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isInputDisabled}
                            className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-purple-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Upload size={14} /> Upload File
                          </button>
                          <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileUpload}
                            accept=".txt,.md,.csv,.json,.pdf,.docx"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quick Presets</p>
                    <div className="flex flex-col gap-2">
                      {[...presets, ...customPresets].map((preset, idx) => (
                        <button
                          key={idx}
                          onClick={() => setScenario(preset.text)}
                          disabled={isInputDisabled}
                          className="flex items-center gap-2 text-left text-sm bg-slate-800 hover:bg-slate-700 p-2 rounded-md transition-colors text-slate-300 disabled:opacity-50"
                        >
                          <span className="text-blue-400">{preset.icon}</span>
                          {preset.label}
                        </button>
                      ))}

                      {isCreatingPreset ? (
                        <div className="bg-slate-800 p-3 rounded-md border border-slate-700 mt-1 space-y-2">
                          <input
                            type="text"
                            placeholder="Preset Name (e.g. Internal Memo)"
                            className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none text-slate-200"
                            value={newPresetLabel}
                            onChange={(e) => setNewPresetLabel(e.target.value)}
                          />
                          <textarea
                            placeholder="Scenario text..."
                            className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none text-slate-200 resize-none h-16"
                            value={newPresetText}
                            onChange={(e) => setNewPresetText(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button onClick={handleSaveCustomPreset} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs transition-colors flex-grow">Save Preset</button>
                            <button onClick={() => setIsCreatingPreset(false)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1 rounded text-xs transition-colors">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setIsCreatingPreset(true)}
                          disabled={isInputDisabled}
                          className="flex items-center justify-center gap-2 text-left text-sm border border-dashed border-slate-700 hover:border-slate-500 hover:bg-slate-800/50 p-2 rounded-md transition-colors text-slate-400 disabled:opacity-50 mt-1"
                        >
                          <Plus size={16} /> Create Custom Preset
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={runSimulation}
                    disabled={(!scenario.trim() && !attachment) || isInputDisabled}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {status === "idle" || status === "complete" || status === "error" ? (
                      <>
                        <Play size={18} /> Run Simulation
                      </>
                    ) : (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        {status === "generating_personas" && "Spawning Agents..."}
                        {status === "simulating" && `Simulating Round ${currentRound}/3...`}
                        {status === "summarizing" && "Analyzing Results..."}
                      </>
                    )}
                  </button>

                  {errorMsg && (
                    <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <p>{errorMsg}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Persona Roster */}
              {personas.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
                    <Users size={20} className="text-purple-400" />
                    Simulated Cast ({personas.length})
                  </h2>
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                    {personas.map(p => (
                      <div key={p.id} className="p-3 bg-slate-800 rounded-lg flex gap-3 items-start">
                        <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white font-bold text-xs ${p.avatarColor || 'bg-slate-600'}`}>
                          {p.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{p.name}</p>
                          <p className="text-xs text-blue-400 mb-1">{p.role}</p>
                          <p className="text-xs text-slate-400 italic">"{p.bias}"</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Feed & Analytics */}
            <div className="lg:col-span-8 flex flex-col gap-6">

              {/* Top Analytics Bar */}
              {analytics && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                      <BarChart3 size={16} /> Overall Sentiment
                    </div>
                    <div className="text-xl font-bold text-white flex items-center gap-2">
                      {analytics.overallSentiment}
                      <span className={`text-sm px-2 py-0.5 rounded-full ${Number(calculateAverageSentiment()) > 0.2 ? 'bg-emerald-900/50 text-emerald-400' : Number(calculateAverageSentiment()) < -0.2 ? 'bg-red-900/50 text-red-400' : 'bg-slate-800 text-slate-300'}`}>
                        Avg Score: {calculateAverageSentiment()}
                      </span>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg md:col-span-2">
                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                      <AlertTriangle size={16} className="text-amber-400" /> Key Risk Identified
                    </div>
                    <div className="text-sm text-slate-200 font-medium leading-relaxed">
                      {analytics.keyRisk}
                    </div>
                  </div>
                </div>
              )}

              {/* Discussion Feed */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl flex-grow flex flex-col min-h-[400px]">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 rounded-t-xl">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                    <MessageSquare size={20} className="text-emerald-400" />
                    Live Reaction Feed
                  </h2>
                  {status === "simulating" && (
                    <div className="flex items-center gap-2 text-xs font-medium text-blue-400 bg-blue-900/20 px-3 py-1 rounded-full border border-blue-800/50">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                      </span>
                      Round {currentRound}/3
                    </div>
                  )}
                </div>

                <div className="p-4 flex-grow overflow-y-auto space-y-4 max-h-[500px] custom-scrollbar bg-[#0f172a] inset-shadow">
                  {feed.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-3 opacity-50">
                      <Activity size={48} />
                      <p>Awaiting scenario to begin simulation...</p>
                    </div>
                  ) : (
                    feed.map((msg) => {
                      const persona = personas.find(p => p.id === msg.personaId);
                      if (!persona) return null;

                      const isPositive = msg.sentiment > 0.2;
                      const isNegative = msg.sentiment < -0.2;
                      let sentimentBorder = "border-slate-700/50";
                      let sentimentText = "text-slate-400";

                      if (isPositive) {
                        sentimentBorder = "border-emerald-500/30";
                        sentimentText = "text-emerald-400";
                      } else if (isNegative) {
                        sentimentBorder = "border-red-500/30";
                        sentimentText = "text-red-400";
                      }

                      return (
                        <div
                          key={msg.id}
                          className={`flex gap-4 p-4 bg-slate-800/50 rounded-xl border ${sentimentBorder} animate-in slide-in-from-bottom-4 fade-in duration-300`}
                        >
                          <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white font-bold ${persona.avatarColor || 'bg-slate-600'} shadow-md`}>
                            {persona.name.charAt(0)}
                          </div>
                          <div className="flex-grow">
                            <div className="flex items-baseline justify-between mb-1">
                              <h3 className="font-semibold text-slate-200">{persona.name}</h3>
                              <span className="text-xs text-slate-500">Round {msg.round}</span>
                            </div>
                            <p className="text-xs text-blue-400/80 mb-2">{persona.role}</p>
                            <p className="text-sm text-slate-300 leading-relaxed">
                              {msg.text}
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                              <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-sm bg-slate-900 ${sentimentText}`}>
                                Sentiment: {msg.sentiment.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={feedEndRef} />
                </div>
              </div>

              {/* Actionable Report */}
              {analytics && (
                <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-xl p-6 shadow-xl animate-in fade-in zoom-in duration-500">
                  <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
                    <CheckCircle size={24} className="text-blue-400" />
                    Strategic Synthesis
                  </h2>

                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold text-blue-300 uppercase tracking-wider mb-1">Predicted Outcome</h4>
                      <p className="text-slate-200 text-lg leading-relaxed">{analytics.predictedOutcome}</p>
                    </div>

                    <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700">
                      <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Send size={16} /> Actionable Advice
                      </h4>
                      <p className="text-slate-300 font-medium">{analytics.actionableAdvice}</p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto bg-slate-900 rounded-xl p-8 border border-slate-800 shadow-xl space-y-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Info className="text-blue-400" /> About SwarmDynamics
            </h2>
            <div className="space-y-4 text-slate-300 leading-relaxed">
              <p>
                <strong>SwarmDynamics</strong> is a predictive simulation tool that leverages AI to forecast human reactions before they happen. Inspired by swarm intelligence concepts, it allows you to test scenarios from product launches to controversial statements in a safe, simulated sandbox.
              </p>

              <h3 className="text-lg font-semibold text-white mt-6">How it Works</h3>
              <ol className="list-decimal pl-5 space-y-2">
                <li><strong>Persona Generation:</strong> Based on your scenario, the AI spawns a diverse cast of autonomous agents. Each receives a unique background, bias, and communication style (e.g., Skeptical Academic, Angry Customer, Nuanced Journalist).</li>
                <li><strong>Multi-Agent Debate:</strong> The agents converse over multiple rounds. They react to your initial prompt and argue with each other, simulating real-world social media echo chambers and faction dynamics.</li>
                <li><strong>Predictive Synthesis:</strong> Once the simulation concludes, the system analyzes the sentiment shifts and outputs an actionable report, identifying key risks and offering advice before you pull the trigger in the real world.</li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Supported File Uploads</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Text formats:</strong> .txt, .md, .csv, .json (read directly in browser)</li>
                <li><strong>Documents:</strong> .pdf, .docx (text extracted server-side)</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Use Cases</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Product & Engineering:</strong> Test pricing changes, feature deprecations, or platform redesigns (like a Netlify launch).</li>
                <li><strong>Research & Academia:</strong> Simulate peer review pushback or public reception to new methodologies.</li>
                <li><strong>Marketing & PR:</strong> Beta-test controversial blog posts or social media threads to identify potential backlash vectors.</li>
              </ul>

              <p className="mt-4 italic text-slate-400 border-l-4 border-blue-500 pl-4 py-1">
                "Next time you're about to make a decision that affects people, try simulating them first."
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 py-6 border-t border-slate-800/50 text-center text-slate-500 text-sm">
        &copy; 2026 - Dr. Pantaleon Fassbender - <a href="mailto:leo@twistersmanagementconsultingllc.com" className="hover:text-blue-400 transition-colors">leo@twistersmanagementconsultingllc.com</a>
      </footer>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(51, 65, 85, 1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(71, 85, 105, 1);
        }
        .inset-shadow {
          box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.2);
        }
      `}} />
    </div>
  );
}
