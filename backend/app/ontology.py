"""
Sanctum Ontology Configuration
Modular ontology system - swap configs based on document domain.

Usage:
    from ontology import get_ontology, list_ontologies
    
    ontology = get_ontology("bitcoin_technical")  # or "human_rights", etc.
"""

from pydantic import BaseModel
from typing import Optional


class EntityType(BaseModel):
    """Definition of an entity type in the ontology"""
    name: str
    description: str
    properties: list[str]  # Expected properties for this entity type
    example: Optional[str] = None


class RelationshipType(BaseModel):
    """Definition of a relationship type in the ontology"""
    name: str
    description: str
    from_types: list[str]  # Valid source entity types
    to_types: list[str]    # Valid target entity types
    example: Optional[str] = None


class Ontology(BaseModel):
    """Complete ontology configuration for a domain"""
    id: str
    name: str
    description: str
    version: str
    entity_types: list[EntityType]
    relationship_types: list[RelationshipType]
    extraction_prompt: str  # LLM prompt template for this domain


# =============================================================================
# BITCOIN TECHNICAL PAPERS ONTOLOGY (DEFAULT)
# =============================================================================

BITCOIN_TECHNICAL_ONTOLOGY = Ontology(
    id="bitcoin_technical",
    name="Bitcoin Technical Papers",
    description="Ontology for Bitcoin whitepapers, BIPs, and technical documentation",
    version="1.0.0",
    entity_types=[
        EntityType(
            name="Concept",
            description="A technical concept or idea (e.g., 'proof-of-work', 'double-spending')",
            properties=["name", "definition", "category"],
            example="Proof-of-Work: A consensus mechanism requiring computational effort"
        ),
        EntityType(
            name="Protocol",
            description="A defined protocol or system (e.g., 'Bitcoin', 'Lightning Network')",
            properties=["name", "purpose", "version"],
            example="Bitcoin: A peer-to-peer electronic cash system"
        ),
        EntityType(
            name="Algorithm",
            description="A specific algorithm or method (e.g., 'SHA-256', 'ECDSA')",
            properties=["name", "type", "complexity"],
            example="SHA-256: Cryptographic hash function used for mining"
        ),
        EntityType(
            name="CryptographicPrimitive",
            description="Fundamental cryptographic building block",
            properties=["name", "type", "security_assumption"],
            example="Elliptic Curve Digital Signature Algorithm (ECDSA)"
        ),
        EntityType(
            name="AttackVector",
            description="A potential attack or vulnerability",
            properties=["name", "description", "mitigation"],
            example="51% Attack: Majority hashpower can rewrite blockchain history"
        ),
        EntityType(
            name="Component",
            description="A system component or data structure",
            properties=["name", "purpose", "structure"],
            example="Merkle Tree: Binary tree structure for efficient transaction verification"
        ),
        EntityType(
            name="Actor",
            description="A participant or role in the system",
            properties=["name", "role", "incentives"],
            example="Miner: Network participant who validates transactions"
        ),
        EntityType(
            name="Claim",
            description="A specific technical claim or assertion",
            properties=["text", "confidence", "source_location"],
            example="The system is secure as long as honest nodes control majority of CPU power"
        ),
    ],
    relationship_types=[
        RelationshipType(
            name="USES",
            description="One thing uses or depends on another",
            from_types=["Protocol", "Algorithm", "Component"],
            to_types=["Algorithm", "CryptographicPrimitive", "Component", "Concept"],
            example="Bitcoin USES SHA-256"
        ),
        RelationshipType(
            name="PREVENTS",
            description="One thing prevents or mitigates another",
            from_types=["Concept", "Algorithm", "Protocol", "Component"],
            to_types=["AttackVector"],
            example="Proof-of-Work PREVENTS double-spending"
        ),
        RelationshipType(
            name="ENABLES",
            description="One thing enables or makes possible another",
            from_types=["Concept", "Algorithm", "CryptographicPrimitive"],
            to_types=["Concept", "Protocol", "Component"],
            example="Digital signatures ENABLES trustless transactions"
        ),
        RelationshipType(
            name="COMPOSED_OF",
            description="One thing is composed of or contains another",
            from_types=["Protocol", "Component"],
            to_types=["Component", "Algorithm", "Concept"],
            example="Block COMPOSED_OF Merkle Tree"
        ),
        RelationshipType(
            name="PARTICIPATES_IN",
            description="An actor participates in a process or protocol",
            from_types=["Actor"],
            to_types=["Protocol", "Concept"],
            example="Miner PARTICIPATES_IN consensus"
        ),
        RelationshipType(
            name="EXPLOITS",
            description="An attack exploits a vulnerability or weakness",
            from_types=["AttackVector"],
            to_types=["Component", "Protocol", "Concept"],
            example="Sybil Attack EXPLOITS identity-free network"
        ),
        RelationshipType(
            name="SUPPORTED_BY",
            description="A claim is supported by a source or evidence",
            from_types=["Claim"],
            to_types=["Concept", "Algorithm", "Component"],
            example="Claim SUPPORTED_BY mathematical proof"
        ),
    ],
    extraction_prompt="""You are extracting structured knowledge from a Bitcoin/cryptocurrency technical document.

Given the following text chunk, extract:

1. ENTITIES - Technical concepts, protocols, algorithms, components, actors, and claims
2. RELATIONSHIPS - How these entities relate to each other

For each entity, identify:
- type: One of [Concept, Protocol, Algorithm, CryptographicPrimitive, AttackVector, Component, Actor, Claim]
- name: Clear identifier
- properties: Relevant attributes based on entity type

For each relationship, identify:
- type: One of [USES, PREVENTS, ENABLES, COMPOSED_OF, PARTICIPATES_IN, EXPLOITS, SUPPORTED_BY]
- from_entity: Source entity name
- to_entity: Target entity name
- evidence: Brief quote or reasoning from the text

Return as JSON:
{
  "entities": [
    {"type": "...", "name": "...", "properties": {...}}
  ],
  "relationships": [
    {"type": "...", "from_entity": "...", "to_entity": "...", "evidence": "..."}
  ]
}

TEXT CHUNK:
"""
)


# =============================================================================
# HUMAN RIGHTS ONTOLOGY (PLACEHOLDER)
# =============================================================================

HUMAN_RIGHTS_ONTOLOGY = Ontology(
    id="human_rights",
    name="Human Rights Documentation",
    description="Ontology for human rights reports, testimony, and legal documentation",
    version="0.1.0",
    entity_types=[
        EntityType(
            name="Claim",
            description="A specific factual assertion about an event or situation",
            properties=["text", "date", "confidence"],
            example="Detention occurred on March 15, 2024"
        ),
        EntityType(
            name="Actor",
            description="Individual or organization involved",
            properties=["name", "type", "role"],
            example="Organization X (perpetrator)"
        ),
        EntityType(
            name="Event",
            description="A specific incident or occurrence",
            properties=["description", "date", "location"],
            example="Protest dispersal on 2024-03-15"
        ),
        EntityType(
            name="Location",
            description="Geographic location",
            properties=["name", "type", "coordinates"],
            example="City Center, Country X"
        ),
        EntityType(
            name="Violation",
            description="Categorized human rights violation",
            properties=["type", "severity", "legal_basis"],
            example="Arbitrary Detention (ICCPR Art. 9)"
        ),
        EntityType(
            name="Source",
            description="Information source",
            properties=["type", "reliability", "date"],
            example="Witness testimony, high reliability"
        ),
        EntityType(
            name="LegalInstrument",
            description="Treaty, law, or convention",
            properties=["name", "jurisdiction", "articles"],
            example="ICCPR Article 9"
        ),
    ],
    relationship_types=[
        RelationshipType(
            name="SUPPORTED_BY",
            description="Claim supported by source",
            from_types=["Claim"],
            to_types=["Source"],
        ),
        RelationshipType(
            name="DESCRIBES",
            description="Claim describes an event",
            from_types=["Claim"],
            to_types=["Event"],
        ),
        RelationshipType(
            name="ALLEGES",
            description="Claim alleges a violation",
            from_types=["Claim"],
            to_types=["Violation"],
        ),
        RelationshipType(
            name="OCCURRED_AT",
            description="Event occurred at location",
            from_types=["Event"],
            to_types=["Location"],
        ),
        RelationshipType(
            name="INVOLVED",
            description="Event involved an actor",
            from_types=["Event"],
            to_types=["Actor"],
        ),
        RelationshipType(
            name="PERPETRATED",
            description="Actor perpetrated violation",
            from_types=["Actor"],
            to_types=["Violation"],
        ),
        RelationshipType(
            name="VIOLATES",
            description="Violation violates legal instrument",
            from_types=["Violation"],
            to_types=["LegalInstrument"],
        ),
    ],
    extraction_prompt="""You are extracting structured knowledge from a human rights document.

Given the following text chunk, extract entities and relationships according to the HURIDOCS "Who Did What to Whom" framework.

[Placeholder - to be refined with human rights expert input]

TEXT CHUNK:
"""
)


# =============================================================================
# HUMAN RIGHTS ASSISTANCE ONTOLOGY (DEFAULT)
# =============================================================================

HUMAN_RIGHTS_ASSISTANCE_ONTOLOGY = Ontology(
    id="HumanRightsAssistance",
    name="Human Rights Assistance",
    description="Guidance for victims/families under stress in high-risk contexts",
    version="1.0.0",
    entity_types=[
        EntityType(
            name="Situation",
            description="Current state/phase of the case",
            properties=["type", "legal_definition", "indicators", "urgency_level", "typical_duration"],
            example="Forced Disappearance: Detained with no official information provided"
        ),
        EntityType(
            name="Actor",
            description="Person or organization involved",
            properties=["name", "type", "role", "contact_info", "jurisdiction"],
            example="PPST: NGO providing accompaniment and legal guidance"
        ),
        EntityType(
            name="Right",
            description="Legal entitlement that applies",
            properties=["name", "legal_basis", "conditions", "limitations", "how_to_invoke"],
            example="Right to legal counsel"
        ),
        EntityType(
            name="Risk",
            description="Threat or danger to case/person",
            properties=["type", "severity", "indicators", "affected_parties", "likelihood"],
            example="Retaliation against family members"
        ),
        EntityType(
            name="Action",
            description="Recommended step to take",
            properties=["description", "timing", "priority", "prerequisites", "expected_outcome"],
            example="File habeas corpus within 48 hours"
        ),
        EntityType(
            name="Resource",
            description="Available support or assistance",
            properties=["type", "provider", "eligibility", "how_to_access", "limitations"],
            example="Emergency legal aid fund"
        ),
        EntityType(
            name="Evidence",
            description="Documentation of events",
            properties=["type", "how_to_collect", "preservation", "sensitivity", "chain_of_custody"],
            example="Medical records documenting injuries"
        ),
        EntityType(
            name="Mechanism",
            description="Legal or advocacy channel",
            properties=["name", "jurisdiction", "type", "process", "timeline", "requirements"],
            example="UN Special Rapporteur urgent appeal"
        ),
        EntityType(
            name="Guidance",
            description="Context-specific advice",
            properties=["context", "recommendation", "rationale", "cautions", "timing"],
            example="Delay media exposure until legal counsel is secured"
        ),
        EntityType(
            name="Pitfall",
            description="Common mistake that harms cases",
            properties=["description", "why_harmful", "who_makes_it", "consequences", "alternative"],
            example="Sharing detention location publicly"
        ),
        EntityType(
            name="Precondition",
            description="Requirement before taking action",
            properties=["requirement", "how_to_verify", "consequences_if_ignored"],
            example="Verified safe channel before sharing details"
        ),
        EntityType(
            name="Contraindication",
            description="Context where action is dangerous",
            properties=["action", "dangerous_context", "why_dangerous", "safer_alternative"],
            example="Do not name witnesses before relocation"
        ),
        EntityType(
            name="Consequence",
            description="Result of an action or mistake",
            properties=["type", "severity", "reversibility", "affected_parties"],
            example="Evidence becomes inadmissible"
        ),
        EntityType(
            name="TimeWindow",
            description="Time-sensitive window for action",
            properties=["name", "duration", "start_trigger", "end_trigger"],
            example="First 48 hours after detention"
        ),
        EntityType(
            name="Channel",
            description="Communication channel for safe coordination",
            properties=["name", "security_level", "availability", "notes"],
            example="Signal"
        ),
        EntityType(
            name="Barrier",
            description="Resource or safety constraint",
            properties=["type", "severity", "workaround"],
            example="No transportation or funds for travel"
        ),
    ],
    relationship_types=[
        RelationshipType(
            name="APPLIES_IN",
            description="Right or risk applies in a situation",
            from_types=["Right", "Risk"],
            to_types=["Situation"],
            example="Right to legal counsel APPLIES_IN arbitrary detention"
        ),
        RelationshipType(
            name="MITIGATES",
            description="Action reduces a risk",
            from_types=["Action"],
            to_types=["Risk"],
            example="Secure communications MITIGATES surveillance risk"
        ),
        RelationshipType(
            name="PROVIDES",
            description="Actor provides a resource or action",
            from_types=["Actor"],
            to_types=["Resource", "Action"],
            example="NGO PROVIDES legal accompaniment"
        ),
        RelationshipType(
            name="RECOMMENDS",
            description="Guidance recommends an action",
            from_types=["Guidance"],
            to_types=["Action"],
            example="Guidance RECOMMENDS immediate documentation"
        ),
        RelationshipType(
            name="REQUIRES",
            description="Action requires a resource or precondition",
            from_types=["Action"],
            to_types=["Resource", "Precondition"],
            example="Filing complaint REQUIRES legal representation"
        ),
        RelationshipType(
            name="REQUIRES_FIRST",
            description="Action needs a precondition met first",
            from_types=["Action"],
            to_types=["Precondition"],
            example="Media interview REQUIRES_FIRST legal counsel approval"
        ),
        RelationshipType(
            name="ESCALATES_TO",
            description="Mechanism leads to a higher mechanism",
            from_types=["Mechanism"],
            to_types=["Mechanism"],
            example="National court ESCALATES_TO regional commission"
        ),
        RelationshipType(
            name="DOCUMENTS",
            description="Evidence documents a situation or right violation",
            from_types=["Evidence"],
            to_types=["Situation", "Right"],
            example="Medical records DOCUMENTS torture allegations"
        ),
        RelationshipType(
            name="CAUTIONS_AGAINST",
            description="Guidance warns against an action or pitfall",
            from_types=["Guidance"],
            to_types=["Action", "Pitfall"],
            example="Guidance CAUTIONS_AGAINST premature media exposure"
        ),
        RelationshipType(
            name="INVOLVES",
            description="Situation involves an actor",
            from_types=["Situation"],
            to_types=["Actor"],
            example="Detention INVOLVES security forces"
        ),
        RelationshipType(
            name="TRIGGERED_BY",
            description="Situation triggered by an action or situation",
            from_types=["Situation"],
            to_types=["Action", "Situation"],
            example="Forced disappearance TRIGGERED_BY arrest"
        ),
        RelationshipType(
            name="HARMS_CASE_IF",
            description="Action harms case under conditions",
            from_types=["Action"],
            to_types=["Situation", "Precondition"],
            example="Public accusation HARMS_CASE_IF evidence not documented"
        ),
        RelationshipType(
            name="CONTRAINDICATED_IN",
            description="Action is dangerous in context",
            from_types=["Action"],
            to_types=["Situation", "Contraindication"],
            example="Confronting authorities CONTRAINDICATED_IN early detention"
        ),
        RelationshipType(
            name="WORSENS",
            description="Pitfall worsens risk or situation",
            from_types=["Pitfall"],
            to_types=["Risk", "Situation"],
            example="Posting photos WORSENS surveillance risk"
        ),
        RelationshipType(
            name="FORECLOSES",
            description="Pitfall forecloses a mechanism or right",
            from_types=["Pitfall"],
            to_types=["Mechanism", "Right", "Action"],
            example="Accepting informal deal FORECLOSES international complaint"
        ),
        RelationshipType(
            name="SAFER_ALTERNATIVE",
            description="Safer action recommended instead",
            from_types=["Pitfall", "Action"],
            to_types=["Action"],
            example="Public posting SAFER_ALTERNATIVE private documentation"
        ),
        RelationshipType(
            name="DELAY_UNTIL",
            description="Action should wait for a precondition",
            from_types=["Action"],
            to_types=["Precondition"],
            example="Press conference DELAY_UNTIL family safety confirmed"
        ),
        RelationshipType(
            name="INVALIDATES",
            description="Pitfall invalidates evidence or mechanism",
            from_types=["Pitfall"],
            to_types=["Evidence", "Mechanism"],
            example="Altering documents INVALIDATES chain of custody"
        ),
        RelationshipType(
            name="LEADS_TO",
            description="Action or pitfall leads to a consequence",
            from_types=["Action", "Pitfall"],
            to_types=["Consequence"],
            example="Confronting alone LEADS_TO own detention"
        ),
        RelationshipType(
            name="PROTECTS_AGAINST",
            description="Resource or action protects against a risk",
            from_types=["Resource", "Action"],
            to_types=["Risk"],
            example="Legal representation PROTECTS_AGAINST coerced confession"
        ),
        RelationshipType(
            name="AVAILABLE_FOR",
            description="Resource available for an actor type",
            from_types=["Resource"],
            to_types=["Actor"],
            example="Emergency fund AVAILABLE_FOR families"
        ),
        RelationshipType(
            name="ADDRESSES",
            description="Action or resource addresses a situation",
            from_types=["Action", "Resource"],
            to_types=["Situation"],
            example="Habeas corpus ADDRESSES arbitrary detention"
        ),
        RelationshipType(
            name="SAFE_VIA",
            description="Action or guidance safe only via channel",
            from_types=["Action", "Guidance"],
            to_types=["Channel"],
            example="Sharing details SAFE_VIA secure channel"
        ),
        RelationshipType(
            name="BLOCKED_BY",
            description="Action or mechanism blocked by a barrier",
            from_types=["Action", "Mechanism"],
            to_types=["Barrier"],
            example="Filing complaint BLOCKED_BY no transport"
        ),
        RelationshipType(
            name="TIME_SENSITIVE",
            description="Action should be taken within a time window",
            from_types=["Action"],
            to_types=["TimeWindow"],
            example="Initial report TIME_SENSITIVE first 72 hours"
        ),
    ],
    extraction_prompt="""You are extracting structured knowledge from a human rights assistance document intended for victims and families under stress.

Focus on actionable guidance, risks, rights, and "don't do" contraindications. Do NOT invent facts. If the text is unclear, omit.

Given the following text chunk, extract:

1. ENTITIES - situations, actors, rights, risks, actions, resources, evidence, mechanisms, guidance, pitfalls, preconditions, contraindications, consequences, time windows, channels, barriers
2. RELATIONSHIPS - how these entities relate in ways that change decisions or safety

For each entity, identify:
- type: One of [Situation, Actor, Right, Risk, Action, Resource, Evidence, Mechanism, Guidance, Pitfall, Precondition, Contraindication, Consequence, TimeWindow, Channel, Barrier]
- name: Clear identifier
- properties: Relevant attributes based on entity type

For each relationship, identify:
- type: One of [APPLIES_IN, MITIGATES, PROVIDES, RECOMMENDS, REQUIRES, REQUIRES_FIRST, ESCALATES_TO, DOCUMENTS, CAUTIONS_AGAINST, INVOLVES, TRIGGERED_BY, HARMS_CASE_IF, CONTRAINDICATED_IN, WORSENS, FORECLOSES, SAFER_ALTERNATIVE, DELAY_UNTIL, INVALIDATES, LEADS_TO, PROTECTS_AGAINST, AVAILABLE_FOR, ADDRESSES, SAFE_VIA, BLOCKED_BY, TIME_SENSITIVE]
- from_entity: Source entity name
- to_entity: Target entity name
- evidence: Brief quote or reasoning from the text

Return as JSON:
{
  "entities": [
    {"type": "...", "name": "...", "properties": {...}}
  ],
  "relationships": [
    {"type": "...", "from_entity": "...", "to_entity": "...", "evidence": "..."}
  ]
}

TEXT CHUNK:
"""
)


# =============================================================================
# ONTOLOGY REGISTRY
# =============================================================================

ONTOLOGY_REGISTRY: dict[str, Ontology] = {
    "bitcoin_technical": BITCOIN_TECHNICAL_ONTOLOGY,
    "human_rights": HUMAN_RIGHTS_ONTOLOGY,
    "HumanRightsAssistance": HUMAN_RIGHTS_ASSISTANCE_ONTOLOGY,
}

DEFAULT_ONTOLOGY = "HumanRightsAssistance"


def get_ontology(ontology_id: str | None = None) -> Ontology:
    """Get an ontology by ID, or return the default"""
    if ontology_id is None:
        ontology_id = DEFAULT_ONTOLOGY
    
    if ontology_id not in ONTOLOGY_REGISTRY:
        raise ValueError(f"Unknown ontology: {ontology_id}. Available: {list(ONTOLOGY_REGISTRY.keys())}")
    
    return ONTOLOGY_REGISTRY[ontology_id]


def list_ontologies() -> list[dict]:
    """List all available ontologies"""
    return [
        {
            "id": ont.id,
            "name": ont.name,
            "description": ont.description,
            "version": ont.version,
            "entity_types": [e.name for e in ont.entity_types],
            "relationship_types": [r.name for r in ont.relationship_types],
        }
        for ont in ONTOLOGY_REGISTRY.values()
    ]


def register_ontology(ontology: Ontology) -> None:
    """Register a new ontology at runtime"""
    ONTOLOGY_REGISTRY[ontology.id] = ontology
