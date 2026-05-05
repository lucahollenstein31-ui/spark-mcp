#!/usr/bin/env node

/**
 * Spark.re MCP Server
 * Model Context Protocol server for Spark.re CRM API
 *
 * Version: 1.6.1
 * Last Updated: 2025-10-22
 *
 * CRITICAL FIX (v1.6.1):
 * - get_lead_sources now returns TOTAL contact counts matching Spark UI (e.g., 81 Website leads)
 * - Previous version only showed "engaged" contacts with interactions (e.g., 43 Website leads)
 * - Critical for marketing ROI analysis - need to see ALL leads generated, not just contacted ones
 * - Fetches all contacts by registration_source_id, then filters by project using projects array
 *
 * Recent enhancements (v1.6.0):
 * - get_sales_funnel: Sales pipeline analytics with rating distribution and conversion metrics
 * - Uses interaction-based workaround for proper contact/rating data retrieval
 *
 * Recent enhancements (v1.5.0):
 * - AUTOMATIC ID ENRICHMENT: All tool responses now automatically show human-readable names
 * - Interaction summaries display "Email Out (32%)" instead of "Type ID 17861 (32%)"
 * - Team activity shows "Nicholle DiPinto: 40 interactions" instead of "Team Member 7927: 40"
 * - In-memory caching eliminates redundant API calls for reference data
 * - No more manual ID translation needed - enrichment happens automatically
 *
 * Previous enhancements (v1.4.0):
 * - REFERENCE DATA TOOLS: Map numeric IDs to human-readable names
 * - list_interaction_types: Get all interaction type definitions (e.g., "Phone Call", "Email")
 * - list_team_members: Get all team members with ID → name mapping
 * - list_ratings: Get all contact rating definitions (e.g., "Hot Lead", "Agent")
 * - Enables Claude to display readable names instead of numeric IDs in analytics
 *
 * Previous enhancements (v1.3.0):
 * - PAGINATION SUPPORT: All list/search tools now support pagination via page parameter
 * - search_contacts: Added page parameter to access beyond first 100 results
 * - get_contacts_by_criteria: Added page parameter for full dataset access
 * - search_interactions: Added page parameter with pagination metadata
 * - get_interaction_summary: Added page parameter for large datasets
 * - list_projects: Added page parameter to access all projects
 * - Pagination metadata: Returns currentPage, totalPages, hasMore, nextPage info
 * - User guidance: Tools now indicate when more results are available
 *
 * Previous enhancements (v1.2.0):
 * - get_contacts_by_criteria: Advanced filtering for batch analysis (25-100 contacts)
 * - get_interaction_summary: Aggregate interaction data with cadence analysis
 * - get_lead_sources: Marketing source performance and ROI analysis
 * - AI-optimized output: Data formatted for pattern recognition and insights
 *
 * Previous enhancements (v1.1.0):
 * - create_update_contact: Create new contacts or update existing ones (write operation)
 * - log_interaction: Log calls, meetings, emails, and other touchpoints (write operation)
 * - add_contact_note: Add quick notes to contact records (write operation)
 * - Full sales workflow support: create contact → log interaction → add notes
 *
 * Core features:
 * - search_contacts: Fixed OR logic by using 3 parallel API requests
 * - get_contact_details: Fixed notes formatting (was showing [object Object])
 * - list_projects: Added defensive response format handling
 * - search_interactions: Added defensive response format handling + optional contact_id
 * - get_project_details: Enhanced with location, statistics, buildings, marketing info
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SparkAPIClient } from "./api/client.js";

// Initialize the MCP server
const server = new Server(
  {
    name: "spark-re-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize Spark API client
let sparkApi: SparkAPIClient;

try {
  sparkApi = new SparkAPIClient();

  // Test API response format on startup (only runs once)
  sparkApi.testAPIResponseFormat().catch(err => {
    console.error("Warning: API format test failed (server will continue):", err.message);
  });
} catch (error) {
  console.error("Failed to initialize Spark API client:", error);
  process.exit(1);
}

/**
 * Register available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_contacts",
      description: "Search for contacts in Spark.re CRM by name, email, project, or rating. Returns contact details including email, phone, project assignment, and last interaction date. Supports pagination to access all results beyond the first 100.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term - can be name, email, or phone number"
          },
          project_id: {
            type: "number",
            description: "Optional: Filter by specific project ID"
          },
          rating_id: {
            type: "number",
            description: "Optional: Filter by lead rating ID"
          },
          limit: {
            type: "number",
            description: "Maximum number of results per page (default: 25, max: 100)"
          },
          page: {
            type: "number",
            description: "Page number to retrieve (default: 1). Use this to access results beyond the first page."
          }
        }
      }
    },
    {
      name: "get_contact_details",
      description: "Get full details for a specific contact by ID, including all interactions, notes, and project assignments",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: {
            type: "number",
            description: "The unique ID of the contact"
          }
        },
        required: ["contact_id"]
      }
    },
    {
      name: "list_projects",
      description: "List all projects in Spark.re with basic information. Supports pagination to access all projects.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of results per page (default: 25, max: 100)"
          },
          page: {
            type: "number",
            description: "Page number to retrieve (default: 1). Use this to access results beyond the first page."
          }
        }
      }
    },
    {
      name: "get_project_details",
      description: "Get detailed information for a specific project by ID",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "The unique ID of the project"
          }
        },
        required: ["project_id"]
      }
    },
    {
      name: "search_interactions",
      description: "Search for contact interactions (calls, emails, meetings, notes) by contact, date range, or type. Supports pagination to access all results.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: {
            type: "number",
            description: "Optional: Filter by specific contact ID"
          },
          interaction_type_id: {
            type: "number",
            description: "Optional: Filter by interaction type ID"
          },
          days_ago: {
            type: "number",
            description: "Optional: Show interactions from last N days (default: 30)"
          },
          limit: {
            type: "number",
            description: "Maximum number of results per page (default: 25, max: 100)"
          },
          page: {
            type: "number",
            description: "Page number to retrieve (default: 1). Use this to access results beyond the first page."
          }
        }
      }
    },
    {
      name: "create_update_contact",
      description: "Create a new contact or update an existing one in Spark.re CRM. Use this to add leads from calls, meetings, or referrals. For updates, provide contact_id.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: {
            type: "number",
            description: "Optional: ID of existing contact to update. Omit to create new contact."
          },
          project_id: {
            type: "number",
            description: "Required for new contacts: Project ID to assign contact to"
          },
          first_name: {
            type: "string",
            description: "Required: Contact's first name"
          },
          last_name: {
            type: "string",
            description: "Required: Contact's last name"
          },
          email: {
            type: "string",
            description: "Required: Contact's email address"
          },
          phone: {
            type: "string",
            description: "Optional: Primary phone number"
          },
          mobile_phone: {
            type: "string",
            description: "Optional: Mobile phone number"
          },
          work_phone: {
            type: "string",
            description: "Optional: Work phone number"
          },
          address_line_1: {
            type: "string",
            description: "Optional: Street address line 1"
          },
          address_line_2: {
            type: "string",
            description: "Optional: Street address line 2"
          },
          city: {
            type: "string",
            description: "Optional: City"
          },
          province: {
            type: "string",
            description: "Optional: State/Province"
          },
          postcode: {
            type: "string",
            description: "Optional: Postal/ZIP code"
          },
          country_iso: {
            type: "string",
            description: "Optional: Country ISO code (e.g., USA, CAN)"
          },
          agent: {
            type: "boolean",
            description: "Optional: Mark as real estate agent (true/false)"
          },
          marketing_source: {
            type: "string",
            description: "Optional: How they found out about the project (e.g., 'Website', 'Referral', 'Walk-in')"
          }
        },
        required: ["first_name", "last_name", "email"]
      }
    },
    {
      name: "log_interaction",
      description: "Log a call, meeting, email, or other interaction with a contact. Use this to track all sales activities and touchpoints.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: {
            type: "number",
            description: "Required: ID of the contact this interaction is with"
          },
          project_id: {
            type: "number",
            description: "Required: Project ID this interaction relates to"
          },
          interaction_type_id: {
            type: "number",
            description: "Required: Type of interaction. Common types: 1=Call, 2=Email, 3=Meeting, 4=Note. Check your Spark project for exact IDs."
          },
          timestamp: {
            type: "string",
            description: "Optional: When the interaction occurred (ISO 8601 format, e.g., '2025-10-10T14:30:00Z'). Defaults to now if omitted."
          },
          notes: {
            type: "string",
            description: "Optional: Details about the interaction (what was discussed, next steps, etc.)"
          }
        },
        required: ["contact_id", "project_id", "interaction_type_id"]
      }
    },
    {
      name: "add_contact_note",
      description: "Add a note to a contact's record. Use this for quick observations, follow-up reminders, or important details that don't fit other interaction types.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: {
            type: "number",
            description: "Required: ID of the contact to add the note to"
          },
          project_id: {
            type: "number",
            description: "Required: Project ID the contact belongs to"
          },
          note: {
            type: "string",
            description: "Required: The note content (observations, reminders, important details)"
          }
        },
        required: ["contact_id", "project_id", "note"]
      }
    },
    {
      name: "get_contacts_by_criteria",
      description: "Advanced contact filtering for batch analysis. Returns larger datasets with full metadata for AI pattern recognition, conversion analysis, and cohort studies. Use this to answer questions like 'Which rating converts best?' or 'Compare agent vs direct leads'. Supports pagination to access all matching records.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "Optional: Filter by specific project ID"
          },
          rating_id: {
            type: "number",
            description: "Optional: Filter by lead rating ID (hot/warm/cold)"
          },
          registration_source_id: {
            type: "number",
            description: "Optional: Filter by registration source ID"
          },
          agent: {
            type: "boolean",
            description: "Optional: Filter for agents (true) or buyers (false)"
          },
          created_after: {
            type: "string",
            description: "Optional: Include contacts created after this date (ISO 8601 format, e.g., '2025-09-01T00:00:00Z')"
          },
          created_before: {
            type: "string",
            description: "Optional: Include contacts created before this date (ISO 8601 format)"
          },
          has_email: {
            type: "boolean",
            description: "Optional: Filter for contacts with email addresses (true) or without (false)"
          },
          limit: {
            type: "number",
            description: "Maximum number of results per page (default: 50, max: 100)"
          },
          page: {
            type: "number",
            description: "Page number to retrieve (default: 1). Use this to access results beyond the first page."
          }
        }
      }
    },
    {
      name: "get_interaction_summary",
      description: "Aggregate interaction data for pattern analysis. Returns interaction counts by type, activity trends over time, response cadence, and team performance. Use this to answer questions like 'What's our average follow-up time?' or 'Which interaction types correlate with conversions?'. Supports pagination for large datasets.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "Optional: Filter by specific project ID"
          },
          contact_id: {
            type: "number",
            description: "Optional: Filter by specific contact ID for individual analysis"
          },
          interaction_type_id: {
            type: "number",
            description: "Optional: Filter by specific interaction type"
          },
          days_ago: {
            type: "number",
            description: "Optional: Analyze interactions from last N days (default: 30)"
          },
          created_after: {
            type: "string",
            description: "Optional: Include interactions after this date (ISO 8601 format)"
          },
          limit: {
            type: "number",
            description: "Maximum number of raw interactions to fetch per page for analysis (default: 100, max: 100)"
          },
          page: {
            type: "number",
            description: "Page number to retrieve (default: 1). Use this to access results beyond the first page."
          }
        }
      }
    },
    {
      name: "get_lead_sources",
      description: "Analyze lead source performance and marketing effectiveness. Returns all registration sources with contact counts, conversion rates, and recent activity. Use this to answer questions like 'Which marketing channel brings the best leads?' or 'What's our ROI by source?'.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "Optional: Filter by specific project ID"
          },
          include_agent_sources: {
            type: "boolean",
            description: "Optional: Include sources for real estate agents (default: true)"
          },
          min_contact_count: {
            type: "number",
            description: "Optional: Only show sources with at least this many contacts (default: 1)"
          },
          days_ago: {
            type: "number",
            description: "Optional: Only analyze contacts added in last N days (default: all time)"
          }
        }
      }
    },
    {
      name: "list_interaction_types",
      description: "Get all interaction type definitions for a project (e.g., 'Phone Call', 'Email', 'Meeting'). Use this to map interaction_type_id numbers to human-readable labels. Results are cached as this reference data changes infrequently.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "Required: Project ID to get interaction types for"
          }
        },
        required: ["project_id"]
      }
    },
    {
      name: "list_team_members",
      description: "Get all team members/users for a project. Use this to map team_member_id numbers to names (e.g., '7927' → 'Nicholle DiPinto McKiernan'). Results are cached as this reference data changes infrequently.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "Required: Project ID to get team members for"
          }
        },
        required: ["project_id"]
      }
    },
    {
      name: "list_ratings",
      description: "Get all contact rating definitions for a project (e.g., 'Hot Lead', 'Warm', 'Cold', 'Agent'). Use this to map rating_id numbers to human-readable labels and understand the rating system.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "Required: Project ID to get ratings for"
          }
        },
        required: ["project_id"]
      }
    },
    {
      name: "get_sales_funnel",
      description: "Get sales pipeline funnel with rating distribution, stage progression, and conversion metrics. Returns real-time data showing how contacts move through the sales process.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "number",
            description: "Required: Project ID to analyze"
          },
          days_ago: {
            type: "number",
            description: "Optional: Only include contacts active in last N days (default: all contacts with interactions)"
          },
          include_inactive: {
            type: "boolean",
            description: "Optional: Include contacts with no interactions (default: false, only engaged contacts)"
          }
        },
        required: ["project_id"]
      }
    }
  ]
}));

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_contacts":
        return await handleSearchContacts(args);

      case "get_contact_details":
        return await handleGetContactDetails(args);

      case "list_projects":
        return await handleListProjects(args);

      case "get_project_details":
        return await handleGetProjectDetails(args);

      case "search_interactions":
        return await handleSearchInteractions(args);

      case "create_update_contact":
        return await handleCreateUpdateContact(args);

      case "log_interaction":
        return await handleLogInteraction(args);

      case "add_contact_note":
        return await handleAddContactNote(args);

      case "get_contacts_by_criteria":
        return await handleGetContactsByCriteria(args);

      case "get_interaction_summary":
        return await handleGetInteractionSummary(args);

      case "get_lead_sources":
        return await handleGetLeadSources(args);

      case "list_interaction_types":
        return await handleListInteractionTypes(args);

      case "list_team_members":
        return await handleListTeamMembers(args);

      case "list_ratings":
        return await handleListRatings(args);

      case "get_sales_funnel":
        return await handleGetSalesFunnel(args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: `Error: ${errorMessage}`
      }],
      isError: true
    };
  }
});

/**
 * Tool handler: Search contacts
 */
async function handleSearchContacts(args: any) {
  const { query = '', project_id, rating_id, limit = 25, page = 1 } = args;

  // Cap limit at 100 to match Spark API limits
  const effectiveLimit = Math.min(limit, 100);

  const baseParams: Record<string, any> = {
    per_page: effectiveLimit,
    page: page
  };

  if (project_id) baseParams.project_id_eq = project_id;
  if (rating_id) baseParams.rating_id_eq = rating_id;

  // If query is provided, search across first_name, last_name, AND email using OR logic
  // Spark API doesn't support OR across different fields, so we make 3 parallel requests
  if (query) {
    try {
      const baseQueryString = sparkApi.buildQueryString(baseParams);

      // Make 3 parallel requests: first_name, last_name, email
      const [firstNameResponse, lastNameResponse, emailResponse] = await Promise.all([
        sparkApi.getWithPagination(`/contacts${baseQueryString ? baseQueryString + '&' : '?'}first_name_cont=${encodeURIComponent(query)}`),
        sparkApi.getWithPagination(`/contacts${baseQueryString ? baseQueryString + '&' : '?'}last_name_cont=${encodeURIComponent(query)}`),
        sparkApi.getWithPagination(`/contacts${baseQueryString ? baseQueryString + '&' : '?'}email_cont=${encodeURIComponent(query)}`)
      ]);

      // Merge and deduplicate results by ID
      const allContacts = mergeContactResults(firstNameResponse.data, lastNameResponse.data, emailResponse.data);

      // Limit to requested number
      const limitedContacts = allContacts.slice(0, effectiveLimit);

      // Use pagination info from first response (they should all be similar)
      return formatContactsResponse(limitedContacts, firstNameResponse.pagination);
    } catch (error) {
      throw new Error(`Contact search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // No query provided - just use filters
  const queryString = sparkApi.buildQueryString(baseParams);
  const response: any = await sparkApi.getWithPagination(`/contacts${queryString}`);
  return formatContactsResponse(response.data, response.pagination);
}

/**
 * Merge contact results from multiple API calls and remove duplicates
 */
function mergeContactResults(...responses: any[]): any[] {
  const contactMap = new Map<number, any>();

  for (const response of responses) {
    let contacts: any[] = [];

    // Handle different response formats
    if (Array.isArray(response)) {
      contacts = response;
    } else if (response && response.data && Array.isArray(response.data)) {
      contacts = response.data;
    } else if (response && typeof response === 'object' && response.id) {
      contacts = [response];
    }

    // Add to map (deduplicates by ID)
    for (const contact of contacts) {
      if (contact && contact.id) {
        contactMap.set(contact.id, contact);
      }
    }
  }

  return Array.from(contactMap.values());
}

/**
 * Format contacts response - handles both array and object formats
 */
function formatContactsResponse(response: any, pagination?: any) {
  // Handle different response formats
  let contacts: any[] = [];

  if (Array.isArray(response)) {
    contacts = response;
  } else if (response && response.data && Array.isArray(response.data)) {
    contacts = response.data;
  } else if (response && typeof response === 'object') {
    // Single contact returned as object
    contacts = [response];
  }

  if (contacts.length === 0) {
    return {
      content: [{
        type: "text",
        text: "No contacts found matching your criteria."
      }]
    };
  }

  let output = `Found ${contacts.length} contact(s)`;

  // Add pagination info if available
  if (pagination) {
    output += ` (Page ${pagination.currentPage}`;
    if (pagination.totalPages) {
      output += ` of ${pagination.totalPages}`;
    }
    output += `)`;
  }
  output += `:\n\n`;

  contacts.forEach((contact: any, index: number) => {
    output += `${index + 1}. **${contact.first_name || ''} ${contact.last_name || ''}**\n`;
    output += `   - Email: ${contact.email || 'N/A'}\n`;
    if (contact.phone) output += `   - Phone: ${contact.phone}\n`;
    if (contact.project_name) output += `   - Project: ${contact.project_name}\n`;
    // Ratings come as an array - get the first rating's value
    const ratingDisplay = (contact.ratings && contact.ratings.length > 0)
      ? contact.ratings[0].value
      : undefined;
    if (ratingDisplay) output += `   - Rating: ${ratingDisplay}\n`;
    if (contact.last_interaction_date) output += `   - Last Contact: ${formatDate(contact.last_interaction_date)}\n`;
    output += `   - ID: ${contact.id}\n\n`;
  });

  // Add pagination guidance
  if (pagination && pagination.hasMore) {
    output += `\n---\n`;
    output += `**More results available!** Use page=${pagination.nextPage} to see the next page.\n`;
    if (pagination.totalPages) {
      output += `Total pages: ${pagination.totalPages}\n`;
    }
  }

  return {
    content: [{
      type: "text",
      text: output
    }]
  };
}

/**
 * Tool handler: Get contact details
 */
async function handleGetContactDetails(args: any) {
  const { contact_id } = args;

  if (!contact_id) {
    throw new Error("contact_id is required");
  }

  const contact: any = await sparkApi.get(`/contacts/${contact_id}`);

  let output = `# ${contact.first_name || ''} ${contact.last_name || ''}\n\n`;

  output += `## Contact Information\n`;
  output += `- Email: ${contact.email || 'N/A'}\n`;
  if (contact.phone) output += `- Phone: ${contact.phone}\n`;
  if (contact.address) output += `- Address: ${contact.address}\n`;
  if (contact.city) output += `- City: ${contact.city}\n`;
  // Ratings come as an array - get the first rating's value
  const ratingDisplay = (contact.ratings && contact.ratings.length > 0)
    ? contact.ratings[0].value
    : 'Not rated';
  output += `- Rating: ${ratingDisplay}\n`;
  output += `- Source: ${contact.marketing_source || 'Unknown'}\n`;
  output += `- Created: ${formatDate(contact.created_at)}\n\n`;

  if (contact.project_name) {
    output += `## Project\n`;
    output += `- ${contact.project_name}\n\n`;
  }

  // Format notes - handle array of note objects
  if (contact.notes) {
    output += `## Notes\n`;

    // Check if notes is an array
    if (Array.isArray(contact.notes)) {
      if (contact.notes.length === 0) {
        output += `No notes available.\n\n`;
      } else {
        contact.notes.forEach((note: any) => {
          const noteDate = note.created_at ? formatDate(note.created_at) : 'Unknown date';
          const noteText = note.text || note.content || note.note || 'No content';
          const noteAuthor = note.team_member_name || note.creator_name || '';

          if (noteAuthor) {
            output += `- **${noteDate}** (by ${noteAuthor}): ${noteText}\n`;
          } else {
            output += `- **${noteDate}**: ${noteText}\n`;
          }
        });
        output += '\n';
      }
    } else if (typeof contact.notes === 'object') {
      // Single note object
      const noteDate = contact.notes.created_at ? formatDate(contact.notes.created_at) : 'Unknown date';
      const noteText = contact.notes.text || contact.notes.content || contact.notes.note || 'No content';
      const noteAuthor = contact.notes.team_member_name || contact.notes.creator_name || '';

      if (noteAuthor) {
        output += `- **${noteDate}** (by ${noteAuthor}): ${noteText}\n\n`;
      } else {
        output += `- **${noteDate}**: ${noteText}\n\n`;
      }
    } else if (typeof contact.notes === 'string') {
      // Plain text note
      output += `${contact.notes}\n\n`;
    } else {
      // Unknown format - show debug info
      output += `[Note format: ${typeof contact.notes}]\n\n`;
    }
  }

  return {
    content: [{
      type: "text",
      text: output
    }]
  };
}

/**
 * Tool handler: List projects
 */
async function handleListProjects(args: any) {
  const { limit = 25, page = 1 } = args;

  // Cap limit at 100
  const effectiveLimit = Math.min(limit, 100);

  const params = {
    per_page: effectiveLimit,
    page: page
  };

  const queryString = sparkApi.buildQueryString(params);
  const response: any = await sparkApi.getWithPagination(`/projects${queryString}`);

  // Handle different response formats
  let projects: any[] = [];

  if (Array.isArray(response.data)) {
    projects = response.data;
  } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
    projects = response.data.data;
  } else if (response.data && typeof response.data === 'object' && response.data.id) {
    // Single project returned as object
    projects = [response.data];
  }

  if (projects.length === 0) {
    return {
      content: [{
        type: "text",
        text: "No projects found."
      }]
    };
  }

  let output = `Found ${projects.length} project(s)`;

  // Add pagination info if available
  if (response.pagination) {
    output += ` (Page ${response.pagination.currentPage}`;
    if (response.pagination.totalPages) {
      output += ` of ${response.pagination.totalPages}`;
    }
    output += `)`;
  }
  output += `:\n\n`;

  projects.forEach((project: any, index: number) => {
    output += `${index + 1}. **${project.name}**\n`;
    if (project.kind) output += `   - Type: ${project.kind}\n`;
    if (project.sales_stage) output += `   - Sales Stage: ${project.sales_stage}\n`;
    if (project.province || project.state) output += `   - Location: ${project.province || project.state}\n`;
    output += `   - ID: ${project.id}\n\n`;
  });

  // Add pagination guidance
  if (response.pagination && response.pagination.hasMore) {
    output += `\n---\n`;
    output += `**More results available!** Use page=${response.pagination.nextPage} to see the next page.\n`;
    if (response.pagination.totalPages) {
      output += `Total pages: ${response.pagination.totalPages}\n`;
    }
  }

  return {
    content: [{
      type: "text",
      text: output
    }]
  };
}

/**
 * Tool handler: Get project details
 */
async function handleGetProjectDetails(args: any) {
  const { project_id } = args;

  if (!project_id) {
    throw new Error("project_id is required");
  }

  const project: any = await sparkApi.get(`/projects/${project_id}`);

  let output = `# ${project.name}\n\n`;

  output += `## Project Information\n`;
  if (project.kind) output += `- Type: ${project.kind}\n`;
  if (project.sales_stage) output += `- Sales Stage: ${project.sales_stage}\n`;
  if (project.state) output += `- Status: ${project.state}\n`;
  if (project.lease !== undefined) output += `- Lease: ${project.lease ? 'Yes' : 'No'}\n`;
  if (project.start_date) output += `- Start Date: ${formatDate(project.start_date)}\n`;
  output += `- Created: ${formatDate(project.created_at)}\n`;
  if (project.updated_at) output += `- Last Updated: ${formatDate(project.updated_at)}\n\n`;

  // Location details
  if (project.address_line_1 || project.city || project.province || project.state || project.country_name) {
    output += `## Location\n`;
    if (project.address_line_1) {
      output += `- Address: ${project.address_line_1}`;
      if (project.address_line_2) output += ` ${project.address_line_2}`;
      output += '\n';
    }
    if (project.city) output += `- City: ${project.city}\n`;
    if (project.province || project.state) output += `- State/Province: ${project.province || project.state}\n`;
    if (project.postcode) output += `- Postal Code: ${project.postcode}\n`;
    if (project.country_name) output += `- Country: ${project.country_name}\n`;
    if (project.time_zone) output += `- Time Zone: ${project.time_zone}\n`;
    output += '\n';
  }

  // Contacts & Inventory
  output += `## Statistics\n`;
  if (project.contacts_count !== undefined) output += `- Total Contacts: ${project.contacts_count}\n`;
  if (project.currency) output += `- Currency: ${project.currency}\n`;
  if (project.area_unit) output += `- Area Unit: ${project.area_unit}\n`;
  output += '\n';

  // Buildings (if any)
  if (project.buildings && Array.isArray(project.buildings) && project.buildings.length > 0) {
    output += `## Buildings\n`;
    project.buildings.forEach((building: any, index: number) => {
      output += `${index + 1}. ${building.name || `Building ${building.id}`}\n`;
    });
    output += '\n';
  }

  // Marketing info
  if (project.marketing_fee_percentage || project.marketing_fee_based_on) {
    output += `## Marketing\n`;
    if (project.marketing_fee_percentage) output += `- Marketing Fee: ${project.marketing_fee_percentage}%\n`;
    if (project.marketing_fee_based_on) output += `- Fee Based On: ${project.marketing_fee_based_on}\n`;
    output += '\n';
  }

  // Additional info
  if (project.permalink) output += `**Permalink:** ${project.permalink}\n`;
  if (project.disclaimer) output += `\n**Disclaimer:** ${project.disclaimer}\n`;

  return {
    content: [{
      type: "text",
      text: output
    }]
  };
}

/**
 * Tool handler: Search interactions
 */
async function handleSearchInteractions(args: any) {
  const { contact_id, interaction_type_id, days_ago = 30, limit = 25, page = 1 } = args;

  // Cap limit at 100
  const effectiveLimit = Math.min(limit, 100);

  const params: Record<string, any> = {
    per_page: effectiveLimit,
    page: page
  };

  if (contact_id) params.contact_id_eq = contact_id;
  if (interaction_type_id) params.interaction_type_id_eq = interaction_type_id;

  // Filter by date if days_ago is specified
  if (days_ago) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days_ago);
    params.created_at_gteq = cutoffDate.toISOString();
  }

  const queryString = sparkApi.buildQueryString(params);
  const response: any = await sparkApi.getWithPagination(`/interactions${queryString}`);

  // Handle different response formats
  let interactions: any[] = [];

  if (Array.isArray(response.data)) {
    interactions = response.data;
  } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
    interactions = response.data.data;
  } else if (response.data && typeof response.data === 'object' && response.data.id) {
    // Single interaction returned as object
    interactions = [response.data];
  }

  if (interactions.length === 0) {
    return {
      content: [{
        type: "text",
        text: "No interactions found matching your criteria."
      }]
    };
  }

  // Determine project_id for enrichment (from args or first interaction)
  const project_id = args.project_id || (interactions.length > 0 ? interactions[0].project_id : null);

  // Enrich with human-readable names
  let typeMap = new Map<number, string>();
  let teamMap = new Map<number, string>();
  if (project_id) {
    try {
      [typeMap, teamMap] = await Promise.all([
        sparkApi.getInteractionTypeMap(project_id),
        sparkApi.getTeamMemberMap(project_id)
      ]);
    } catch (error) {
      // If enrichment fails, continue with IDs only
      console.error('Failed to enrich interaction data:', error);
    }
  }

  let output = `Found ${interactions.length} interaction(s)`;

  // Add pagination info if available
  if (response.pagination) {
    output += ` (Page ${response.pagination.currentPage}`;
    if (response.pagination.totalPages) {
      output += ` of ${response.pagination.totalPages}`;
    }
    output += `)`;
  }
  output += `:\n\n`;

  interactions.forEach((interaction: any, index: number) => {
    // Enrich interaction type
    const typeName = interaction.interaction_type ||
                     (interaction.interaction_type_id && typeMap.get(interaction.interaction_type_id)) ||
                     (interaction.interaction_type_id ? `Type ${interaction.interaction_type_id}` : 'Interaction');

    output += `${index + 1}. **${typeName}**\n`;
    output += `   - Date: ${formatDate(interaction.timestamp || interaction.created_at)}\n`;

    // Enrich team member
    if (interaction.team_member_id) {
      const memberName = teamMap.get(interaction.team_member_id) || `Team Member ${interaction.team_member_id}`;
      output += `   - Team Member: ${memberName}\n`;
    }

    if (interaction.notes) output += `   - Notes: ${interaction.notes}\n`;
    if (interaction.contact_id) output += `   - Contact ID: ${interaction.contact_id}\n`;
    output += `   - ID: ${interaction.id}\n\n`;
  });

  // Add pagination guidance
  if (response.pagination && response.pagination.hasMore) {
    output += `\n---\n`;
    output += `**More results available!** Use page=${response.pagination.nextPage} to see the next page.\n`;
    if (response.pagination.totalPages) {
      output += `Total pages: ${response.pagination.totalPages}\n`;
    }
  }

  return {
    content: [{
      type: "text",
      text: output
    }]
  };
}

/**
 * Tool handler: Create or update contact
 */
async function handleCreateUpdateContact(args: any) {
  const { contact_id, project_id, ...contactData } = args;

  // Validate required fields for new contacts
  if (!contact_id) {
    if (!contactData.first_name || !contactData.last_name || !contactData.email) {
      throw new Error("first_name, last_name, and email are required for new contacts");
    }
    if (!project_id) {
      throw new Error("project_id is required for new contacts");
    }
  }

  try {
    let contact: any;
    let isUpdate = false;

    if (contact_id) {
      // Update existing contact
      isUpdate = true;
      contact = await sparkApi.put(`/contacts/${contact_id}`, {
        contact: contactData
      });
    } else {
      // Create new contact
      contact = await sparkApi.post(`/projects/${project_id}/contacts`, {
        contact: contactData
      });
    }

    // Format success response
    let output = `# Contact ${isUpdate ? 'Updated' : 'Created'} Successfully\n\n`;
    output += `**${contact.first_name} ${contact.last_name}**\n\n`;
    output += `## Details\n`;
    output += `- ID: ${contact.id}\n`;
    output += `- Email: ${contact.email || 'N/A'}\n`;
    if (contact.phone) output += `- Phone: ${contact.phone}\n`;
    if (contact.mobile_phone) output += `- Mobile: ${contact.mobile_phone}\n`;
    if (contact.work_phone) output += `- Work Phone: ${contact.work_phone}\n`;
    if (contact.city || contact.province) {
      output += `- Location: ${[contact.city, contact.province].filter(Boolean).join(', ')}\n`;
    }
    if (contact.agent) output += `- Type: Real Estate Agent\n`;
    if (contact.marketing_source) output += `- Source: ${contact.marketing_source}\n`;
    output += `- Created: ${formatDate(contact.created_at)}\n`;
    if (isUpdate && contact.updated_at) output += `- Updated: ${formatDate(contact.updated_at)}\n`;

    output += `\n**Next steps:** You can now log interactions or add notes to this contact using ID ${contact.id}.`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to ${contact_id ? 'update' : 'create'} contact: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: Log interaction
 */
async function handleLogInteraction(args: any) {
  const { contact_id, project_id, interaction_type_id, timestamp, notes } = args;

  if (!contact_id || !project_id || !interaction_type_id) {
    throw new Error("contact_id, project_id, and interaction_type_id are required");
  }

  try {
    // Build interaction data
    const interactionData: any = {
      contact_id,
      project_id,
      interaction_type_id,
    };

    // Add timestamp if provided, otherwise API will use current time
    if (timestamp) {
      interactionData.timestamp = timestamp;
    }

    // Add notes if provided
    if (notes) {
      interactionData.notes = notes;
    }

    const interaction: any = await sparkApi.post(`/projects/${project_id}/interactions`, {
      interaction: interactionData
    });

    // Format success response
    let output = `# Interaction Logged Successfully\n\n`;
    output += `## Details\n`;
    output += `- ID: ${interaction.id}\n`;
    output += `- Contact ID: ${interaction.contact_id}\n`;
    output += `- Type ID: ${interaction.interaction_type_id}\n`;
    output += `- Timestamp: ${formatDate(interaction.timestamp || interaction.created_at)}\n`;
    if (interaction.notes) output += `- Notes: ${interaction.notes}\n`;
    output += `- Created: ${formatDate(interaction.created_at)}\n`;

    output += `\n**Success!** This interaction is now part of the contact's history.`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to log interaction: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: Add contact note
 */
async function handleAddContactNote(args: any) {
  const { contact_id, project_id, note } = args;

  if (!contact_id || !project_id || !note) {
    throw new Error("contact_id, project_id, and note are required");
  }

  try {
    // Notes in Spark are typically stored as interactions with a specific type
    // We'll need to use a Note interaction type - commonly type_id varies by project
    // For now, we'll add this as a contact note through the notes endpoint

    const noteData: any = {
      contact_id,
      text: note,
      created_at: new Date().toISOString()
    };

    // Attempt to post note to contact
    // The exact endpoint may vary - trying common patterns
    let noteResponse: any;
    try {
      noteResponse = await sparkApi.post(`/contacts/${contact_id}/notes`, {
        note: noteData
      });
    } catch (error) {
      // If that doesn't work, try as a project note
      noteResponse = await sparkApi.post(`/projects/${project_id}/contacts/${contact_id}/notes`, {
        note: noteData
      });
    }

    // Format success response
    let output = `# Note Added Successfully\n\n`;
    output += `## Details\n`;
    if (noteResponse.id) output += `- Note ID: ${noteResponse.id}\n`;
    output += `- Contact ID: ${contact_id}\n`;
    output += `- Content: "${note}"\n`;
    output += `- Created: ${formatDate(noteResponse.created_at || new Date().toISOString())}\n`;

    output += `\n**Success!** This note is now attached to the contact's record.`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to add note: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: Get contacts by criteria (Analytics)
 */
async function handleGetContactsByCriteria(args: any) {
  const {
    project_id,
    rating_id,
    registration_source_id,
    agent,
    created_after,
    created_before,
    has_email,
    limit = 50,
    page = 1
  } = args;

  // Cap limit at 100 for performance
  const effectiveLimit = Math.min(limit, 100);

  try {
    const params: Record<string, any> = {
      per_page: effectiveLimit,
      page: page
    };

    // Apply filters
    if (project_id) params.project_id_eq = project_id;
    if (rating_id) params.rating_id_eq = rating_id;
    if (registration_source_id) params.registration_source_id_eq = registration_source_id;
    if (agent !== undefined) params.agent_eq = agent;
    if (created_after) params.created_at_gteq = created_after;
    if (created_before) params.created_at_lteq = created_before;

    const queryString = sparkApi.buildQueryString(params);
    const response: any = await sparkApi.getWithPagination(`/contacts${queryString}`);

    // Handle different response formats
    let contacts: any[] = [];
    if (Array.isArray(response.data)) {
      contacts = response.data;
    } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
      contacts = response.data.data;
    } else if (response.data && typeof response.data === 'object' && response.data.id) {
      contacts = [response.data];
    }

    // Apply email filter if needed (API may not support this directly)
    if (has_email !== undefined) {
      contacts = contacts.filter(c => has_email ? !!c.email : !c.email);
    }

    // Format for AI analysis
    let output = `# Contact Analysis Dataset\n\n`;
    output += `**Total Contacts on Page:** ${contacts.length}\n`;
    if (response.pagination) {
      output += `**Page:** ${response.pagination.currentPage}`;
      if (response.pagination.totalPages) {
        output += ` of ${response.pagination.totalPages}`;
      }
      output += `\n`;
    }
    output += `**Filters Applied:** ${Object.keys(args).filter(k => args[k] !== undefined && k !== 'limit' && k !== 'page').join(', ') || 'None'}\n\n`;

    // Summary statistics
    const stats = {
      with_email: contacts.filter(c => c.email).length,
      with_phone: contacts.filter(c => c.phone || c.mobile_phone).length,
      agents: contacts.filter(c => c.agent).length,
      with_last_interaction: contacts.filter(c => c.last_interaction_date).length,
      with_source: contacts.filter(c => c.marketing_source || c.registration_source_id).length
    };

    // Helper function to safely calculate percentage
    const safePercentage = (count: number, total: number): string => {
      return total === 0 ? '0' : Math.round(count / total * 100).toString();
    };

    output += `## Summary Statistics\n`;
    output += `- Contacts with Email: ${stats.with_email} (${safePercentage(stats.with_email, contacts.length)}%)\n`;
    output += `- Contacts with Phone: ${stats.with_phone} (${safePercentage(stats.with_phone, contacts.length)}%)\n`;
    output += `- Real Estate Agents: ${stats.agents} (${safePercentage(stats.agents, contacts.length)}%)\n`;
    output += `- With Interaction History: ${stats.with_last_interaction} (${safePercentage(stats.with_last_interaction, contacts.length)}%)\n`;
    output += `- With Source Attribution: ${stats.with_source} (${safePercentage(stats.with_source, contacts.length)}%)\n\n`;

    // Group by source for pattern analysis
    const sourceGroups = new Map<string, number>();
    contacts.forEach(c => {
      const source = c.marketing_source || c.registration_source_id?.toString() || 'Unknown';
      sourceGroups.set(source, (sourceGroups.get(source) || 0) + 1);
    });

    if (sourceGroups.size > 0 && sourceGroups.size <= 20) {
      output += `## Lead Sources Distribution\n`;
      const sortedSources = Array.from(sourceGroups.entries()).sort((a, b) => b[1] - a[1]);
      sortedSources.forEach(([source, count]) => {
        output += `- ${source}: ${count} contacts (${safePercentage(count, contacts.length)}%)\n`;
      });
      output += '\n';
    }

    // Date distribution (by month)
    const dateGroups = new Map<string, number>();
    contacts.forEach(c => {
      if (c.created_at) {
        const date = new Date(c.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        dateGroups.set(monthKey, (dateGroups.get(monthKey) || 0) + 1);
      }
    });

    if (dateGroups.size > 0 && dateGroups.size <= 12) {
      output += `## Contact Acquisition Timeline\n`;
      const sortedDates = Array.from(dateGroups.entries()).sort();
      sortedDates.forEach(([month, count]) => {
        output += `- ${month}: ${count} contacts\n`;
      });
      output += '\n';
    }

    // Detailed contact list for AI analysis
    output += `## Contact Details (for analysis)\n\n`;
    contacts.forEach((contact, index) => {
      output += `### ${index + 1}. ${contact.first_name || ''} ${contact.last_name || ''} (ID: ${contact.id})\n`;
      if (contact.email) output += `- Email: ${contact.email}\n`;
      if (contact.phone) output += `- Phone: ${contact.phone}\n`;
      if (contact.agent) output += `- Type: Agent\n`;
      if (contact.marketing_source) output += `- Source: ${contact.marketing_source}\n`;
      if (contact.registration_source_id) output += `- Source ID: ${contact.registration_source_id}\n`;
      if (contact.last_interaction_date) output += `- Last Activity: ${formatDate(contact.last_interaction_date)}\n`;
      output += `- Added: ${formatDate(contact.created_at)}\n`;
      if (contact.city || contact.province) output += `- Location: ${[contact.city, contact.province].filter(Boolean).join(', ')}\n`;
      output += '\n';
    });

    output += `\n---\n**Analysis Ready:** This dataset contains ${contacts.length} contacts with full metadata for pattern recognition and cohort analysis.\n`;

    // Add pagination guidance
    if (response.pagination && response.pagination.hasMore) {
      output += `\n**More results available!** Use page=${response.pagination.nextPage} to see the next page.\n`;
      if (response.pagination.totalPages) {
        output += `Total pages: ${response.pagination.totalPages}\n`;
      }
    }

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to fetch contacts by criteria: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: Get interaction summary (Analytics)
 */
async function handleGetInteractionSummary(args: any) {
  const {
    project_id,
    contact_id,
    interaction_type_id,
    days_ago = 30,
    created_after,
    limit = 100,
    page = 1
  } = args;

  try {
    // Cap limit at 100
    const effectiveLimit = Math.min(limit, 100);

    const params: Record<string, any> = {
      per_page: effectiveLimit,
      page: page
    };

    if (project_id) params.project_id_eq = project_id;
    if (contact_id) params.contact_id_eq = contact_id;
    if (interaction_type_id) params.interaction_type_id_eq = interaction_type_id;

    // Date filtering
    if (created_after) {
      params.created_at_gteq = created_after;
    } else if (days_ago) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days_ago);
      params.created_at_gteq = cutoffDate.toISOString();
    }

    const queryString = sparkApi.buildQueryString(params);
    const response: any = await sparkApi.getWithPagination(`/interactions${queryString}`);

    // Handle different response formats
    let interactions: any[] = [];
    if (Array.isArray(response.data)) {
      interactions = response.data;
    } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
      interactions = response.data.data;
    } else if (response.data && typeof response.data === 'object' && response.data.id) {
      interactions = [response.data];
    }

    // Enrich with human-readable names
    let typeMap = new Map<number, string>();
    let teamMap = new Map<number, string>();
    if (project_id) {
      try {
        [typeMap, teamMap] = await Promise.all([
          sparkApi.getInteractionTypeMap(project_id),
          sparkApi.getTeamMemberMap(project_id)
        ]);
      } catch (error) {
        // If enrichment fails, continue with IDs only
        console.error('Failed to enrich interaction summary:', error);
      }
    }

    // Aggregate data for analysis
    let output = `# Interaction Analysis Summary\n\n`;
    output += `**Total Interactions on Page:** ${interactions.length}\n`;
    if (response.pagination) {
      output += `**Page:** ${response.pagination.currentPage}`;
      if (response.pagination.totalPages) {
        output += ` of ${response.pagination.totalPages}`;
      }
      output += `\n`;
    }
    output += `**Time Period:** ${days_ago ? `Last ${days_ago} days` : 'Custom range'}\n`;
    output += `**Filters:** ${Object.keys(args).filter(k => args[k] !== undefined && k !== 'limit' && k !== 'page').join(', ') || 'None'}\n\n`;

    // Count by interaction type
    const typeGroups = new Map<number, number>();
    interactions.forEach(i => {
      const typeId = i.interaction_type_id;
      typeGroups.set(typeId, (typeGroups.get(typeId) || 0) + 1);
    });

    output += `## Interaction Types Breakdown\n`;
    const sortedTypes = Array.from(typeGroups.entries()).sort((a, b) => b[1] - a[1]);
    sortedTypes.forEach(([typeId, count]) => {
      const percentage = Math.round(count / interactions.length * 100);
      const typeName = typeMap.get(typeId) || `Type ID ${typeId}`;
      output += `- ${typeName}: ${count} interactions (${percentage}%)\n`;
    });
    output += '\n';

    // Count by team member
    const teamGroups = new Map<number, number>();
    interactions.forEach(i => {
      if (i.team_member_id) {
        teamGroups.set(i.team_member_id, (teamGroups.get(i.team_member_id) || 0) + 1);
      }
    });

    if (teamGroups.size > 0) {
      output += `## Activity by Team Member\n`;
      const sortedTeam = Array.from(teamGroups.entries()).sort((a, b) => b[1] - a[1]);
      sortedTeam.forEach(([memberId, count]) => {
        const percentage = Math.round(count / interactions.length * 100);
        const memberName = teamMap.get(memberId) || `Team Member ${memberId}`;
        output += `- ${memberName}: ${count} interactions (${percentage}%)\n`;
      });
      output += '\n';
    }

    // Timeline analysis (by day)
    const dateGroups = new Map<string, number>();
    interactions.forEach(i => {
      if (i.timestamp || i.created_at) {
        const date = new Date(i.timestamp || i.created_at);
        const dayKey = date.toISOString().split('T')[0];
        dateGroups.set(dayKey, (dateGroups.get(dayKey) || 0) + 1);
      }
    });

    if (dateGroups.size > 0) {
      output += `## Activity Timeline (Daily)\n`;
      const sortedDates = Array.from(dateGroups.entries()).sort();
      const recentDates = sortedDates.slice(-14); // Last 14 days
      recentDates.forEach(([date, count]) => {
        output += `- ${date}: ${count} interactions\n`;
      });
      if (sortedDates.length > 14) {
        output += `... (showing last 14 days of ${sortedDates.length} total days)\n`;
      }
      output += '\n';
    }

    // Contact engagement analysis
    const contactGroups = new Map<number, number>();
    interactions.forEach(i => {
      if (i.contact_id) {
        contactGroups.set(i.contact_id, (contactGroups.get(i.contact_id) || 0) + 1);
      }
    });

    output += `## Contact Engagement Metrics\n`;
    output += `- Unique Contacts: ${contactGroups.size}\n`;
    output += `- Avg Interactions per Contact: ${(interactions.length / contactGroups.size).toFixed(1)}\n`;

    // Find most engaged contacts
    const sortedContacts = Array.from(contactGroups.entries()).sort((a, b) => b[1] - a[1]);
    const topContacts = sortedContacts.slice(0, 10);
    if (topContacts.length > 0) {
      output += `- Top 10 Most Engaged Contacts:\n`;
      topContacts.forEach(([contactId, count]) => {
        output += `  - Contact ${contactId}: ${count} interactions\n`;
      });
    }
    output += '\n';

    // Response time analysis (time between interactions for same contact)
    if (contactGroups.size > 0 && !contact_id) {
      const responseTimes: number[] = [];
      contactGroups.forEach((_count, contactId) => {
        const contactInteractions = interactions
          .filter(i => i.contact_id === contactId)
          .sort((a, b) => new Date(a.timestamp || a.created_at).getTime() - new Date(b.timestamp || b.created_at).getTime());

        for (let i = 1; i < contactInteractions.length; i++) {
          const prev = new Date(contactInteractions[i-1].timestamp || contactInteractions[i-1].created_at);
          const curr = new Date(contactInteractions[i].timestamp || contactInteractions[i].created_at);
          const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays >= 0) responseTimes.push(diffDays);
        }
      });

      if (responseTimes.length > 0) {
        const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const medianResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)];

        output += `## Follow-up Cadence Analysis\n`;
        output += `- Average Time Between Interactions: ${avgResponseTime.toFixed(1)} days\n`;
        output += `- Median Time Between Interactions: ${medianResponseTime.toFixed(1)} days\n`;
        output += `- Total Follow-up Instances: ${responseTimes.length}\n\n`;
      }
    }

    output += `\n---\n**Analysis Ready:** This summary aggregates ${interactions.length} interactions across ${contactGroups.size} contacts for pattern analysis.\n`;

    // Add pagination guidance
    if (response.pagination && response.pagination.hasMore) {
      output += `\n**More results available!** Use page=${response.pagination.nextPage} to see the next page.\n`;
      if (response.pagination.totalPages) {
        output += `Total pages: ${response.pagination.totalPages}\n`;
      }
    }

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to get interaction summary: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: Get lead sources (Analytics)
 *
 * FIXED (v1.6.1): Now returns TOTAL contact counts per source (matching Spark UI),
 * not just engaged contacts. Uses proper project filtering via projects array.
 */
async function handleGetLeadSources(args: any) {
  const {
    project_id,
    include_agent_sources = true,
    min_contact_count = 1,
    days_ago
  } = args;

  try {
    // Step 1: Get ALL registration sources for the project
    const sourcesResponse: any = await sparkApi.get(`/registration-sources?project_id_eq=${project_id || ''}&per_page=100`);
    let sources: any[] = Array.isArray(sourcesResponse) ? sourcesResponse :
                        (sourcesResponse?.data ? sourcesResponse.data : []);

    if (sources.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No registration sources found for this project."
        }]
      };
    }

    // Step 2: For each source, get ALL contacts with that source
    // Then filter by project using the projects array
    const sourceStats = new Map<string, {
      count: number;
      withEmail: number;
      withPhone: number;
      withInteraction: number;
      agents: number;
      recentActivity: number;
      sourceId: number;
    }>();

    for (const source of sources) {
      const sourceId = source.id;
      const sourceName = source.name;

      // Fetch ALL contacts with this registration source
      let allContactsForSource: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 10) { // Safety limit: max 10 pages (1000 contacts) per source
        const params: Record<string, any> = {
          registration_source_id_eq: sourceId,
          per_page: 100,
          page: page
        };

        // Add date filtering if requested
        if (days_ago) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - days_ago);
          params.created_at_gteq = cutoffDate.toISOString();
        }

        const queryString = sparkApi.buildQueryString(params);
        const response: any = await sparkApi.getWithPagination(`/contacts${queryString}`);

        let contacts: any[] = Array.isArray(response.data) ? response.data :
                             (response.data?.data ? response.data.data : []);

        if (contacts.length === 0) break;

        allContactsForSource.push(...contacts);
        hasMore = response.pagination?.hasMore || false;
        page++;
      }

      // Step 3: Filter contacts by project (fetch full details to check projects array)
      let projectContacts: any[] = [];

      if (project_id) {
        // Batch fetch full contact details to check project assignment
        const batchSize = 20; // Fetch 20 at a time for performance
        for (let i = 0; i < allContactsForSource.length; i += batchSize) {
          const batch = allContactsForSource.slice(i, i + batchSize);
          const batchPromises = batch.map(c =>
            sparkApi.get(`/contacts/${c.id}`).catch(() => null)
          );
          const detailedContacts = await Promise.all(batchPromises);

          // Filter to contacts in the specified project
          detailedContacts.forEach((contact: any) => {
            if (!contact) return;
            const projects = contact.projects || [];
            const inProject = projects.some((p: any) => p.project_id === project_id);
            if (inProject) {
              projectContacts.push(contact);
            }
          });
        }
      } else {
        // No project filter - use all contacts
        projectContacts = allContactsForSource;
      }

      // Filter out agents if requested
      if (!include_agent_sources) {
        projectContacts = projectContacts.filter(c => !c.agent);
      }

      // Skip sources with no contacts after filtering
      if (projectContacts.length === 0) continue;

      // Aggregate stats for this source
      const stats = {
        count: projectContacts.length,
        withEmail: 0,
        withPhone: 0,
        withInteraction: 0,
        agents: 0,
        recentActivity: 0,
        sourceId: sourceId
      };

      projectContacts.forEach(contact => {
        if (contact.email) stats.withEmail++;
        if (contact.phone || contact.mobile_phone) stats.withPhone++;
        if (contact.last_interaction_date) stats.withInteraction++;
        if (contact.agent) stats.agents++;

        // Check if activity in last 30 days
        if (contact.last_interaction_date) {
          const lastInteraction = new Date(contact.last_interaction_date);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          if (lastInteraction > thirtyDaysAgo) stats.recentActivity++;
        }
      });

      sourceStats.set(sourceName, stats);
    }

    // Filter by minimum count and sort
    const filteredSources = Array.from(sourceStats.entries())
      .filter(([_source, stats]) => stats.count >= min_contact_count)
      .sort((a, b) => b[1].count - a[1].count);

    if (filteredSources.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No lead sources found matching your criteria."
        }]
      };
    }

    // Calculate totals
    const totalContacts = filteredSources.reduce((sum, [_, stats]) => sum + stats.count, 0);

    // Format output
    let output = `# Lead Source Performance Analysis\n\n`;
    output += `**Total Contacts Analyzed:** ${totalContacts}\n`;
    output += `**Unique Sources:** ${filteredSources.length}\n`;
    output += `**Time Period:** ${days_ago ? `Last ${days_ago} days` : 'All time'}\n`;
    output += `**Minimum Contacts per Source:** ${min_contact_count}\n`;
    if (project_id) output += `**Project Filter:** Project ${project_id}\n`;
    output += `\n`;

    output += `## Source Performance Ranking\n\n`;

    filteredSources.forEach(([source, stats], index) => {
      const contactQualityScore = Math.round(
        (stats.withEmail / stats.count * 40) +
        (stats.withPhone / stats.count * 30) +
        (stats.withInteraction / stats.count * 30)
      );

      const engagementRate = Math.round(stats.withInteraction / stats.count * 100);

      output += `### ${index + 1}. ${source}\n`;
      output += `- **Total Contacts:** ${stats.count} (${Math.round(stats.count / totalContacts * 100)}% of all leads)\n`;
      output += `- **Engagement Rate:** ${engagementRate}% (${stats.withInteraction} of ${stats.count} contacted)\n`;
      output += `- **Contact Quality Score:** ${contactQualityScore}/100\n`;
      output += `- **Data Completeness:**\n`;
      output += `  - With Email: ${stats.withEmail} (${Math.round(stats.withEmail/stats.count*100)}%)\n`;
      output += `  - With Phone: ${stats.withPhone} (${Math.round(stats.withPhone/stats.count*100)}%)\n`;
      output += `- **Activity:**\n`;
      output += `  - Have Interaction History: ${stats.withInteraction} (${engagementRate}%)\n`;
      output += `  - Recent Activity (30d): ${stats.recentActivity} (${Math.round(stats.recentActivity/stats.count*100)}%)\n`;
      if (stats.agents > 0) {
        output += `- **Agent Referrals:** ${stats.agents} (${Math.round(stats.agents/stats.count*100)}%)\n`;
      }
      output += `- **Source ID:** ${stats.sourceId}\n`;
      output += '\n';
    });

    // Overall insights
    output += `## Key Insights\n\n`;

    // Best source by volume
    const topSource = filteredSources[0];
    if (topSource) {
      output += `- **Highest Volume Source:** ${topSource[0]} with ${topSource[1].count} total contacts\n`;
    }

    // Best engagement rate
    const engagementSorted = filteredSources
      .filter(([_s, stats]) => stats.count >= 5) // Min 5 for meaningful stats
      .sort((a, b) => (b[1].withInteraction / b[1].count) - (a[1].withInteraction / a[1].count));

    if (engagementSorted.length > 0) {
      const topEngaged = engagementSorted[0];
      const rate = Math.round(topEngaged[1].withInteraction / topEngaged[1].count * 100);
      output += `- **Highest Engagement Rate:** ${topEngaged[0]} (${rate}% contacted)\n`;
    }

    // Best quality source (min 5 contacts to be meaningful)
    const qualitySources = filteredSources
      .filter(([_s, stats]) => stats.count >= 5)
      .map(([source, stats]) => ({
        source,
        score: Math.round(
          (stats.withEmail / stats.count * 40) +
          (stats.withPhone / stats.count * 30) +
          (stats.withInteraction / stats.count * 30)
        ),
        count: stats.count
      }))
      .sort((a, b) => b.score - a.score);

    if (qualitySources.length > 0) {
      output += `- **Highest Quality Source:** ${qualitySources[0].source} (Score: ${qualitySources[0].score}/100)\n`;
    }

    output += `\n---\n**Note:** These are TOTAL contact counts matching what you see in Spark.re. `;
    output += `Engagement rates show what percentage have been contacted by your team.\n`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to analyze lead sources: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: List interaction types
 */
async function handleListInteractionTypes(args: any) {
  const { project_id } = args;

  if (!project_id) {
    throw new Error("project_id is required");
  }

  try {
    // Fetch a sample of interactions to extract interaction types
    // We'll fetch enough to hopefully get all types (100 should cover most projects)
    const response: any = await sparkApi.getWithPagination(`/interactions?project_id_eq=${project_id}&per_page=100`);

    let interactions: any[] = [];
    if (Array.isArray(response.data)) {
      interactions = response.data;
    } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
      interactions = response.data.data;
    }

    // Fetch detailed info for a few interactions to get interaction_type objects
    const interactionTypeMap = new Map<number, any>();

    // Fetch details for up to 20 unique interactions to build our type map
    const samplesToFetch = Math.min(interactions.length, 20);
    for (let i = 0; i < samplesToFetch; i++) {
      const interaction = interactions[i];
      try {
        const detailed: any = await sparkApi.get(`/interactions/${interaction.id}`);
        if (detailed.interaction_type) {
          interactionTypeMap.set(detailed.interaction_type.id, detailed.interaction_type);
        }
      } catch (err) {
        // Skip if we can't fetch this one
        continue;
      }

      // If we've got a good sample, stop early
      if (interactionTypeMap.size >= 10) break;
    }

    if (interactionTypeMap.size === 0) {
      return {
        content: [{
          type: "text",
          text: "No interaction types found for this project. The project may not have any interactions yet."
        }]
      };
    }

    // Format output
    let output = `# Interaction Types for Project ${project_id}\n\n`;
    output += `Found ${interactionTypeMap.size} interaction type(s):\n\n`;

    const sortedTypes = Array.from(interactionTypeMap.values()).sort((a, b) => a.id - b.id);

    sortedTypes.forEach((type: any) => {
      output += `- **${type.value}** (ID: ${type.id})\n`;
    });

    output += `\n---\n`;
    output += `**Usage:** Use these IDs when filtering interactions by type, or to translate type IDs to readable names in reports.\n`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to fetch interaction types: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: List team members
 */
async function handleListTeamMembers(args: any) {
  const { project_id } = args;

  if (!project_id) {
    throw new Error("project_id is required");
  }

  try {
    // Use the account-level team-members endpoint (note: dash, not underscore)
    // Team members are account-wide, not project-specific
    const response: any = await sparkApi.get(`/team-members?per_page=100`);

    let members: any[] = [];
    if (Array.isArray(response)) {
      members = response;
    } else if (response && response.data && Array.isArray(response.data)) {
      members = response.data;
    }

    if (members.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No team members found in this account."
        }]
      };
    }

    // Format output
    let output = `# Team Members (Account-Wide)\n\n`;
    output += `**Note:** Team members are account-level and can work across multiple projects.\n\n`;
    output += `Found ${members.length} team member(s):\n\n`;

    const sortedMembers = members.sort((a, b) => {
      const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
      const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    sortedMembers.forEach((member: any) => {
      output += `- **${member.first_name || ''} ${member.last_name || ''}** (ID: ${member.id})\n`;
      if (member.email) output += `  - Email: ${member.email}\n`;
      if (member.job_title) output += `  - Title: ${member.job_title}\n`;
    });

    output += `\n---\n`;
    output += `**Usage:** Use these IDs when filtering by team member, or to translate team_member_id to readable names in reports.\n`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to fetch team members: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Tool handler: List ratings
 */
async function handleListRatings(args: any) {
  const { project_id } = args;

  if (!project_id) {
    throw new Error("project_id is required");
  }

  try {
    // Use the contact-ratings endpoint (note: dash, not underscore)
    // Filter by project_id to get project-specific ratings
    const response: any = await sparkApi.get(`/contact-ratings?project_id_eq=${project_id}&per_page=100`);

    let ratings: any[] = [];
    if (Array.isArray(response)) {
      ratings = response;
    } else if (response && response.data && Array.isArray(response.data)) {
      ratings = response.data;
    }

    if (ratings.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No ratings found for project ${project_id}. The project may not have a rating system configured yet.`
        }]
      };
    }

    // Format output
    let output = `# Contact Ratings for Project ${project_id}\n\n`;
    output += `Found ${ratings.length} rating(s):\n\n`;

    const sortedRatings = ratings.sort((a, b) => (a.position || 999) - (b.position || 999));

    sortedRatings.forEach((rating: any) => {
      output += `- **${rating.value}** (ID: ${rating.id})`;
      if (rating.color) output += ` - Color: ${rating.color}`;
      output += `\n`;
    });

    output += `\n---\n`;
    output += `**Usage:** Use these IDs when filtering contacts by rating, or to translate rating_id to readable labels in reports.\n`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    throw new Error(`Failed to fetch ratings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Format a date string to be more human-readable
 */
function formatDate(dateString: string): string {
  if (!dateString) return 'N/A';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;

  return date.toLocaleDateString();
}

/**
 * Tool handler: Get sales funnel (Analytics)
 * Uses interaction-based workaround to get contact ratings
 */
async function handleGetSalesFunnel(args: any) {
  const { project_id, days_ago, include_inactive = false } = args;

  if (!project_id) {
    throw new Error("project_id is required");
  }

  try {
    // Step 1: Get total contact count from project metadata
    const projects: any = await sparkApi.get('/projects');
    let projectsList: any[] = Array.isArray(projects) ? projects :
                             (projects?.data ? projects.data : []);
    const project = projectsList.find((p: any) => p.id === project_id);
    const totalContacts = project?.contacts_count || 0;

    // Step 2: Paginate through ALL interactions to get contact IDs
    const contactIds = new Set<number>();
    const params: any = {
      per_page: 100,
      project_id_eq: project_id
    };

    if (days_ago) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days_ago);
      params.created_at_gteq = cutoffDate.toISOString();
    }

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) { // Cap at 10 pages (1000 interactions) for performance
      const queryString = sparkApi.buildQueryString({ ...params, page });
      const response: any = await sparkApi.getWithPagination(`/interactions${queryString}`);

      let interactions: any[] = Array.isArray(response.data) ? response.data :
                               (response.data?.data ? response.data.data : []);

      interactions.forEach((i: any) => {
        if (i.contact_id) contactIds.add(i.contact_id);
      });

      hasMore = response.pagination?.hasMore || false;
      page++;
    }

    // Step 3: Fetch contacts individually (list endpoint doesn't return ratings)
    // The /contacts endpoint returns "light" data without ratings, projects, notes, etc.
    // Must use /contacts/{id} endpoint to get full contact data with ratings
    const contactIdArray = Array.from(contactIds);
    const contacts: any[] = [];

    // Fetch contacts in batches of 10 concurrent requests to avoid overwhelming API
    const batchSize = 10;
    for (let i = 0; i < contactIdArray.length; i += batchSize) {
      const batch = contactIdArray.slice(i, i + batchSize);

      // Fetch all contacts in this batch concurrently
      const batchPromises = batch.map(id =>
        sparkApi.get(`/contacts/${id}`).catch(err => {
          console.error(`Failed to fetch contact ${id}:`, err.message);
          return null; // Return null for failed fetches
        })
      );

      const batchResults = await Promise.all(batchPromises);

      // Add successful fetches to contacts array
      batchResults.forEach((contact: any) => {
        if (contact && contact.id) {
          contacts.push(contact);
        }
      });
    }

    // Step 4: Aggregate by rating
    const ratingCounts = new Map<string, {
      rating_id: number;
      count: number;
      color: string;
      contacts: number[];
    }>();

    // Collect debug info
    let contactsWithRatings = 0;
    let contactsWithoutRatings = 0;
    const sampleContactsWithRatings: any[] = [];
    const sampleContactsWithoutRatings: any[] = [];

    contacts.forEach((contact: any) => {
      const rating = contact.ratings?.[0];

      if (!rating) {
        contactsWithoutRatings++;
        if (sampleContactsWithoutRatings.length < 3) {
          sampleContactsWithoutRatings.push({
            id: contact.id,
            name: `${contact.first_name} ${contact.last_name}`,
            ratings: contact.ratings
          });
        }
      } else {
        contactsWithRatings++;
        if (sampleContactsWithRatings.length < 3) {
          sampleContactsWithRatings.push({
            id: contact.id,
            name: `${contact.first_name} ${contact.last_name}`,
            rating: rating
          });
        }
      }

      if (rating) {
        const key = rating.value;
        if (!ratingCounts.has(key)) {
          ratingCounts.set(key, {
            rating_id: rating.id,
            count: 0,
            color: rating.color || '#CCCCCC',
            contacts: []
          });
        }
        const stats = ratingCounts.get(key)!;
        stats.count++;
        stats.contacts.push(contact.id);
      }
    });

    // Step 5: Format output
    let output = `# Sales Funnel Analysis\n\n`;
    output += `**Project:** ${project?.name || project_id}\n`;
    output += `**Total Contacts in System:** ${totalContacts}\n`;
    output += `**Engaged Contacts (with interactions):** ${contacts.length}\n`;
    if (days_ago) {
      output += `**Time Period:** Last ${days_ago} days\n`;
    }
    output += `\n`;

    // Add visible debug info
    output += `## Debug Information\n\n`;
    output += `- **Contacts with ratings:** ${contactsWithRatings}\n`;
    output += `- **Contacts without ratings:** ${contactsWithoutRatings}\n`;
    output += `- **Rating categories found:** ${ratingCounts.size}\n\n`;

    if (sampleContactsWithRatings.length > 0) {
      output += `**Sample contacts WITH ratings:**\n`;
      sampleContactsWithRatings.forEach(c => {
        output += `- ${c.name} (${c.id}): ${c.rating.value} [Color: ${c.rating.color}]\n`;
      });
      output += `\n`;
    }

    if (sampleContactsWithoutRatings.length > 0) {
      output += `**Sample contacts WITHOUT ratings:**\n`;
      sampleContactsWithoutRatings.forEach(c => {
        output += `- ${c.name} (${c.id}): ratings field = ${JSON.stringify(c.ratings)}\n`;
      });
      output += `\n`;
    }

    output += `\n`;

    // Sort ratings by count (descending)
    const sortedRatings = Array.from(ratingCounts.entries())
      .sort((a, b) => b[1].count - a[1].count);

    // Handle empty ratings
    if (sortedRatings.length === 0) {
      output += `**No ratings found.** The ${contacts.length} engaged contacts either:\n`;
      output += `- Have no ratings assigned in Spark\n`;
      output += `- Are not being returned with rating data by the API\n\n`;
    } else {
      output += `## Rating Distribution\n\n`;
      sortedRatings.forEach(([rating, stats], idx) => {
        const percentage = ((stats.count / contacts.length) * 100).toFixed(1);
        output += `${idx + 1}. **${rating}** (ID: ${stats.rating_id})\n`;
        output += `   - Count: ${stats.count} contacts (${percentage}%)\n`;
        output += `   - Color: ${stats.color}\n`;
        output += `\n`;
      });
    }

    // Calculate conversion rates
    output += `## Key Metrics\n\n`;
    output += `- **Engagement Rate:** ${((contacts.length / totalContacts) * 100).toFixed(1)}% `;
    output += `(${contacts.length} of ${totalContacts} contacts have interactions)\n`;

    // Find specific stages for conversion analysis
    const newLeads = ratingCounts.get('New')?.count || 0;
    const hot = ratingCounts.get('Hot')?.count || 0;
    const warm = ratingCounts.get('Warm')?.count || 0;
    const reservations = ratingCounts.get('Reservation Holder')?.count || 0;
    const contracts = ratingCounts.get('Contract Holder')?.count || 0;

    if (newLeads > 0 && hot > 0) {
      output += `- **New → Hot Conversion:** ${((hot / newLeads) * 100).toFixed(1)}%\n`;
    }
    if (hot > 0 && warm > 0) {
      output += `- **Hot → Warm Conversion:** ${((warm / hot) * 100).toFixed(1)}%\n`;
    }
    if (contacts.length > 0 && reservations > 0) {
      output += `- **Contacts → Reservations:** ${((reservations / contacts.length) * 100).toFixed(1)}%\n`;
    }
    if (contacts.length > 0 && contracts > 0) {
      output += `- **Overall Close Rate:** ${((contracts / contacts.length) * 100).toFixed(1)}%\n`;
    }

    output += `\n---\n**Data Source:** ${contacts.length} engaged contacts analyzed from ${contactIdArray.length} unique interaction participants\n`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };

  } catch (error) {
    throw new Error(`Failed to analyze sales funnel: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Export server factory for HTTP transport
 */
export function createSparkMCPServer() {
  return server;
}

/**
 * Start the server (stdio for Claude Desktop)
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Spark.re MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
