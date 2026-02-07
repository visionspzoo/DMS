/*
  # AI Conversations and Custom Agents

  1. New Tables
    - `ai_conversations`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `title` (text) - auto-generated or user-edited title
      - `agent_id` (uuid, nullable) - references custom agent if used
      - `model` (text) - LLM model used
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `ai_conversation_messages`
      - `id` (uuid, primary key)
      - `conversation_id` (uuid, references ai_conversations)
      - `role` (text) - 'user' or 'assistant'
      - `content` (text)
      - `model` (text, nullable) - model used for this response
      - `created_at` (timestamptz)

    - `ai_custom_agents`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text) - agent display name
      - `description` (text) - short description
      - `system_prompt` (text) - base system prompt
      - `is_active` (boolean, default true)
      - `model` (text, nullable) - preferred model for this agent
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `ai_agent_pipeline_steps`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, references ai_custom_agents)
      - `step_order` (integer)
      - `step_name` (text)
      - `prompt_text` (text)

  2. Security
    - RLS enabled on all tables
    - Users can only access their own data
*/

-- ai_conversations
CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  agent_id uuid,
  model text DEFAULT 'claude-sonnet-4',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON ai_conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own conversations"
  ON ai_conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON ai_conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON ai_conversations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id, updated_at DESC);

-- ai_conversation_messages
CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  model text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversation messages"
  ON ai_conversation_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_conversation_messages.conversation_id
      AND ai_conversations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own conversation messages"
  ON ai_conversation_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_conversation_messages.conversation_id
      AND ai_conversations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own conversation messages"
  ON ai_conversation_messages FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_conversation_messages.conversation_id
      AND ai_conversations.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_ai_conversation_messages_conv ON ai_conversation_messages(conversation_id, created_at);

-- ai_custom_agents
CREATE TABLE IF NOT EXISTS ai_custom_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  system_prompt text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  model text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_custom_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agents"
  ON ai_custom_agents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own agents"
  ON ai_custom_agents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agents"
  ON ai_custom_agents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own agents"
  ON ai_custom_agents FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_custom_agents_user ON ai_custom_agents(user_id, is_active);

-- ai_agent_pipeline_steps
CREATE TABLE IF NOT EXISTS ai_agent_pipeline_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES ai_custom_agents(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 0,
  step_name text NOT NULL,
  prompt_text text NOT NULL
);

ALTER TABLE ai_agent_pipeline_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agent steps"
  ON ai_agent_pipeline_steps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_custom_agents
      WHERE ai_custom_agents.id = ai_agent_pipeline_steps.agent_id
      AND ai_custom_agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own agent steps"
  ON ai_agent_pipeline_steps FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_custom_agents
      WHERE ai_custom_agents.id = ai_agent_pipeline_steps.agent_id
      AND ai_custom_agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own agent steps"
  ON ai_agent_pipeline_steps FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_custom_agents
      WHERE ai_custom_agents.id = ai_agent_pipeline_steps.agent_id
      AND ai_custom_agents.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_custom_agents
      WHERE ai_custom_agents.id = ai_agent_pipeline_steps.agent_id
      AND ai_custom_agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own agent steps"
  ON ai_agent_pipeline_steps FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_custom_agents
      WHERE ai_custom_agents.id = ai_agent_pipeline_steps.agent_id
      AND ai_custom_agents.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_ai_agent_steps_agent ON ai_agent_pipeline_steps(agent_id, step_order);

-- Add FK from ai_conversations to ai_custom_agents
ALTER TABLE ai_conversations
  ADD CONSTRAINT fk_ai_conversations_agent
  FOREIGN KEY (agent_id) REFERENCES ai_custom_agents(id) ON DELETE SET NULL;
