export type CookingGroup = { id: string; name: string; is_owner: boolean; owner_id: string; owner_name: string; status: "active" | "pending"; members: {id:string;name:string;profile_picture_url?:string|null;status:"active"|"pending"}[] };
export type CookingGroupList = { items: CookingGroup[] };
